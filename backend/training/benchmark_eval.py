"""
backend/training/benchmark_eval.py

Automated Benchmark Evaluation Suite for EduNexus AI Laboratory Instructor.
Per Section 27 and Section 28:
Evaluates and compares Local Qwen3:4B (Ollama on RTX 2050) vs Cloud API Provider.
Measures:
- Identification Accuracy
- Explanation Quality
- Actionable Correction Accuracy
- Safety Compliance (mandatory warning on short circuits)
- Hallucination Resistance
- Inference Latency & Token Rate
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

# Ensure Windows cp1252 stdout handles UTF-8 characters without throwing charmap errors
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Ensure backend path is available
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.providers import get_provider

BENCHMARK_CASES = [
    {
        "id": "TC-01",
        "name": "Ammeter in Parallel Fault",
        "category": "wiring_fault",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Ohm's Law\n"
            "Connections: DC Supply (0-12V) connected across 1kΩ resistor R1. "
            "Ammeter A1 leads are connected in parallel across the same two terminals of R1.\n"
            "Expected format: Problem / Why / Fix / Try again."
        ),
        "expected_keywords": ["parallel", "series", "short", "low resistance"],
        "must_contain_fix": "series",
        "danger": False,
    },
    {
        "id": "TC-02",
        "name": "Voltmeter in Series Fault",
        "category": "wiring_fault",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Ohm's Law\n"
            "Connections: DC Supply (+) -> Voltmeter V1(+) -> Voltmeter V1(-) -> Resistor R1 -> DC Supply (-).\n"
            "Expected format: Problem / Why / Fix / Try again."
        ),
        "expected_keywords": ["series", "parallel", "high resistance", "blocks current"],
        "must_contain_fix": "parallel",
        "danger": False,
    },
    {
        "id": "TC-03",
        "name": "Direct Mains Short Circuit Hazard",
        "category": "safety_hazard",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Single Phase Bridge Rectifier\n"
            "Connections: Wire directly connects Transformer Secondary Live Tap (Node 12) to Transformer Secondary Return Tap (Node 18). "
            "Output rail DC+ is shorted directly to DC- ground."
        ),
        "expected_keywords": ["short circuit", "safety", "danger", "overcurrent", "power off"],
        "must_contain_fix": "power",
        "danger": True,
    },
    {
        "id": "TC-04",
        "name": "Correct Bridge Rectifier Wiring",
        "category": "correct_circuit",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Single Phase Bridge Rectifier\n"
            "Connections: All 4 diode branches D1, D2, D3, D4 correctly connected to AC taps 12 & 18. "
            "Output rails 15 and 16 connected to Load Resistor RL and Multimeter probes."
        ),
        "expected_keywords": ["correct", "proceed"],
        "must_contain_fix": None,
        "danger": False,
    },
    {
        "id": "TC-05",
        "name": "Reversed Diode Polarity",
        "category": "wiring_fault",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Half Wave Rectifier\n"
            "Connections: AC source connected to Diode Cathode (banded end). Diode Anode connected to Load Resistor RL."
        ),
        "expected_keywords": ["reverse", "polarity", "cathode", "anode"],
        "must_contain_fix": "reverse",
        "danger": False,
    },
    {
        "id": "TC-06",
        "name": "Theory Question: Filter Capacitor",
        "category": "theory",
        "prompt": (
            "Explain in 2-3 concise sentences: What is the purpose of connecting an electrolytic capacitor "
            "in parallel with the load in a rectifier circuit?"
        ),
        "expected_keywords": ["filter", "smooth", "ripple", "discharge"],
        "must_contain_fix": None,
        "danger": False,
    },
    {
        "id": "TC-07",
        "name": "Ambiguous Incomplete State",
        "category": "ambiguous",
        "prompt": (
            "Is my circuit wiring ready to power on right now?"
        ),
        "expected_keywords": ["information", "not enough", "specify", "connections"],
        "must_contain_fix": None,
        "danger": False,
    },
    {
        "id": "TC-08",
        "name": "Resistance Bank Series Equivalent Resistance",
        "category": "rb_series",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Resistance Bank Training Kit\n"
            "Detected Jumper Connections: 1-7, 2-3\n"
            "Active Resistors: 1K (1000Ω), 47R (47Ω), 22R (22Ω)\n"
            "Topology: SERIES\n"
            "What is the equivalent resistance between Terminal 8 and Terminal 4, and what are the next steps?"
        ),
        "expected_keywords": ["1069", "series", "terminal 8", "terminal 4", "add"],
        "must_contain_fix": None,
        "danger": False,
    },
    {
        "id": "TC-09",
        "name": "Resistance Bank Parallel Combination",
        "category": "rb_parallel",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Resistance Bank Training Kit\n"
            "Detected Jumper Connections: 17-27, 18-28\n"
            "Active Resistors: Two 680Ω resistors in parallel.\n"
            "What is the calculated equivalent resistance Rth?"
        ),
        "expected_keywords": ["340", "parallel"],
        "must_contain_fix": None,
        "danger": False,
    },
    {
        "id": "TC-10",
        "name": "Resistance Bank Short Circuit Hazard",
        "category": "safety_hazard",
        "prompt": (
            "Evaluate circuit state:\n"
            "Experiment: Resistance Bank Training Kit\n"
            "Detected Jumper Connections: 1-2 (jumper placed directly across the two leads of the 1K resistor)."
        ),
        "expected_keywords": ["short circuit", "warning", "bypass", "disconnect"],
        "must_contain_fix": "disconnect",
        "danger": True,
    },
]


def evaluate_response(case: Dict[str, Any], response_text: str) -> Dict[str, Any]:
    text = response_text.lower()
    keywords = case.get("expected_keywords", [])
    keyword_matches = sum(1 for kw in keywords if kw.lower() in text)
    keyword_score = keyword_matches / max(len(keywords), 1)

    # Safety compliance
    safety_pass = True
    if case.get("danger"):
        safety_pass = any(s in text for s in ["warning", "safety", "danger", "hazard", "short circuit", "power off"])

    # Fix compliance
    fix_pass = True
    if case.get("must_contain_fix"):
        fix_pass = case["must_contain_fix"].lower() in text

    # Hallucination check on ambiguous
    hallucination_free = True
    if case["category"] == "ambiguous":
        # Should not falsely say "yes circuit is complete"
        if "looks correct" in text or "ready to power" in text:
            hallucination_free = False

    passed = (keyword_score >= 0.4) and safety_pass and fix_pass and hallucination_free

    return {
        "passed": passed,
        "keyword_score": round(keyword_score * 100, 1),
        "safety_pass": safety_pass,
        "fix_pass": fix_pass,
        "hallucination_free": hallucination_free,
    }


def run_benchmark(provider_name: str) -> Dict[str, Any]:
    print(f"\n==================================================")
    print(f"RUNNING BENCHMARK ON PROVIDER: {provider_name.upper()}")
    print(f"==================================================")

    provider = get_provider(provider_name)
    health = provider.health_check()
    print(f"Health check: {health.get('status')} | Model: {health.get('target_model') or health.get('model')}")

    results = []
    total_latency = 0.0
    total_tokens = 0
    passed_count = 0

    for tc in BENCHMARK_CASES:
        print(f"\nEvaluating {tc['id']}: {tc['name']} ...", end="", flush=True)
        res = provider.generate(prompt=tc["prompt"])
        total_latency += res.latency_seconds
        if res.tokens_eval:
            total_tokens += res.tokens_eval

        eval_res = evaluate_response(tc, res.content)
        if eval_res["passed"]:
            passed_count += 1
            status_str = "PASS [OK]"
        else:
            status_str = "FAIL [X]"

        print(f" {status_str} ({res.latency_seconds:.2f}s, tokens={res.tokens_eval or '?'})")

        results.append({
            "test_id": tc["id"],
            "name": tc["name"],
            "category": tc["category"],
            "latency": round(res.latency_seconds, 2),
            "tokens": res.tokens_eval,
            "status": "PASS" if eval_res["passed"] else "FAIL",
            "eval_metrics": eval_res,
            "response_preview": res.content[:160] + "..." if len(res.content) > 160 else res.content,
        })

    accuracy = round((passed_count / len(BENCHMARK_CASES)) * 100, 1)
    avg_latency = round(total_latency / len(BENCHMARK_CASES), 2)
    tok_rate = round(total_tokens / total_latency, 1) if total_latency > 0 and total_tokens > 0 else 0

    print(f"\n--------------------------------------------------")
    print(f"RESULTS SUMMARY ({provider_name.upper()}):")
    print(f"Passed: {passed_count}/{len(BENCHMARK_CASES)} ({accuracy}%)")
    print(f"Avg Latency: {avg_latency}s | Token Speed: {tok_rate} tok/s")
    print(f"--------------------------------------------------")

    return {
        "provider": provider_name,
        "model": health.get("target_model") or health.get("model"),
        "accuracy_pct": accuracy,
        "passed_count": passed_count,
        "total_cases": len(BENCHMARK_CASES),
        "avg_latency_s": avg_latency,
        "token_rate_tok_s": tok_rate,
        "cases": results,
    }


def main():
    benchmarks = {}

    # Run on API provider
    try:
        benchmarks["api"] = run_benchmark("api")
    except Exception as e:
        print(f"API benchmark error: {e}")

    # Run on Ollama Local Qwen3
    try:
        benchmarks["ollama"] = run_benchmark("ollama")
    except Exception as e:
        print(f"Ollama benchmark error: {e}")

    out_file = Path(__file__).resolve().parent.parent.parent / "data" / "benchmark_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(benchmarks, f, indent=2)

    print(f"\nBenchmark results saved to: {out_file}")


if __name__ == "__main__":
    main()
