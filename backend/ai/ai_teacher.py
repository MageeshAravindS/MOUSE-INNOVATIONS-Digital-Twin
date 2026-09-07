"""
ai_teacher.py

Single responsibility: orchestrate the pipeline for one AI-teacher answer.

Pipeline:
load_experiment
    ↓
analyze_connections
    ↓
select teaching mode
    ↓
build prompt
    ↓
(optional) call LLM
"""

from typing import Any, Callable, Dict, Optional, Type

from .context import TeachingContext
from .experiment_loader import (
    load_experiment,
    ExperimentNotFoundError,
    ExperimentLoadError,
)
from .circuit_analyzer import analyze_connections

from .modes.base_mode import BaseMode
from .modes.experiment_mode import ExperimentMode
from .modes.theory_mode import TheoryMode
from .modes.viva_mode import VivaMode
from .modes.evaluator_mode import EvaluatorMode
from .llm_client import generate_answer_full

LLMClient = Callable[[str], str]


_MODE_REGISTRY: Dict[str, Type[BaseMode]] = {
    "experiment": ExperimentMode,
    "theory": TheoryMode,
    "viva": VivaMode,
    "evaluator": EvaluatorMode,
    "circuit_evaluator": EvaluatorMode,
}


def _select_mode(mode_name: str) -> BaseMode:
    """
    Return the teaching mode object.
    """
    mode_class = _MODE_REGISTRY.get(mode_name, ExperimentMode)
    return mode_class()


def get_ai_teacher_answer(
    context: TeachingContext,
    llm_client: Optional[LLMClient] = None,
) -> Dict[str, Any]:
    """
    Generate one AI Teacher response.
    """

    # -------------------------------------------------
    # Step 1 : Load experiment knowledge
    # -------------------------------------------------

    try:
        experiment = load_experiment(context.experiment_name)

    except ExperimentNotFoundError:
        return {
            "status": "error",
            "message": (
                f"Experiment knowledge for '{context.experiment_name}' "
                "is not available yet."
            ),
        }

    except ExperimentLoadError as exc:
        return {
            "status": "error",
            "message": str(exc),
        }

    # -------------------------------------------------
    # Step 2 : Analyze student groups
    # -------------------------------------------------

    correct_groups = experiment.get("correct_groups", {})

    group_metadata = experiment.get("group_metadata", {})

    node_map = experiment.get("node_map", {})

    component_map = experiment.get("component_map", {})

    analysis = analyze_connections(
        student_groups=context.student_connections,
        correct_groups=correct_groups,
        group_metadata=group_metadata,
        node_map=node_map,
        experiment_name=context.experiment_name,
        extra_context=getattr(context, "extra_context", None),
    )

    # Make component map available for prompt builders / frontend
    analysis["component_map"] = component_map

    # -------------------------------------------------
    # Step 3 : Select teaching mode
    # -------------------------------------------------

    mode = _select_mode(context.mode)

    prompt = mode.build(
        context,
        experiment,
        analysis,
    )
    import sys
    try:
        print("\n" + "=" * 80)
        print("AI PROMPT")
        print("=" * 80)
        sys.stdout.buffer.write(prompt.encode("utf-8", errors="replace"))
        sys.stdout.buffer.write(b"\n")
        print("=" * 80 + "\n")
    except Exception:
        pass  # Never let debug logging crash the endpoint

    # -------------------------------------------------
    # Step 4 : Check for instant conversational responses or cache
    # -------------------------------------------------

    from .cache import global_response_cache
    import os
    provider_name = context.provider or os.getenv("LLM_PROVIDER", "ollama")

    q_clean = (context.student_question or "").strip().lower().rstrip("?!., ")
    is_presence = q_clean in (
        "hey you there", "are you there", "you there", "hello", "hi", "hey",
        "good morning", "good afternoon", "good evening", "how are you", "who are you"
    )
    is_onboarding = q_clean in (
        "how do i get started", "how to get started", "how to start",
        "how do i start", "what should i do", "what do i do", "help me start", "get started",
        "where do i start", "how do i use this"
    )
    is_thanks = q_clean in ("thanks", "thank you", "thank you so much", "thx", "appreciate it")

    if is_presence:
        return {
            "status": "success",
            "experiment": experiment.get("experiment", context.experiment_name),
            "mode": context.mode,
            "provider": provider_name,
            "model": "mentor-instant",
            "latency_seconds": 0.001,
            "analysis": analysis,
            "prompt": prompt,
            "answer": (
                "I'm right here! I am your EduNexus AI Practical Laboratory Instructor at Mouse Innovations. "
                "How can I help you with your circuit wiring or electrical theory today?"
            ),
        }

    if is_onboarding:
        if analysis.get("is_resistance_bank"):
            onboarding_ans = (
                "Welcome to the Resistance Bank Practical Lab! To get started:\n"
                "1. Choose two or more resistors on the trainer board.\n"
                "2. Connect jumper patch cords between their terminal sockets to build a series or parallel network.\n"
                "3. In the Practical Evaluation panel, set Measurement Terminals A and B to your network's endpoints, enter your calculated equivalent resistance (Rth), and click 'Check Answer'.\n\n"
                "Ask me anytime: 'Check my wiring' or ask questions about how the resistors combine!"
            )
        else:
            exp_title = experiment.get("experiment", context.experiment_name)
            onboarding_ans = (
                f"Welcome to the {exp_title} experiment! To get started:\n"
                f"1. Review the circuit diagram and component specifications on the trainer board.\n"
                f"2. Connect jumper wires starting with the power supply and rectifying / switching branch.\n"
                f"3. Ask me anytime to verify your connections or explain how each component operates!"
            )
        return {
            "status": "success",
            "experiment": experiment.get("experiment", context.experiment_name),
            "mode": context.mode,
            "provider": provider_name,
            "model": "mentor-instant",
            "latency_seconds": 0.001,
            "analysis": analysis,
            "prompt": prompt,
            "answer": onboarding_ans,
        }

    if is_thanks:
        return {
            "status": "success",
            "experiment": experiment.get("experiment", context.experiment_name),
            "mode": context.mode,
            "provider": provider_name,
            "model": "mentor-instant",
            "latency_seconds": 0.001,
            "analysis": analysis,
            "prompt": prompt,
            "answer": "You're very welcome! Keep up the great work. Let me know whenever you need help with your next connection or calculation!",
        }

    # Extract user question and common intent keywords
    q_raw = context.student_question or ""
    q_lower = q_raw.lower()

    # Detect if this is an explanation / derivation / physics query
    is_explain_query = any(w in q_lower for w in [
        "explain", "how does", "how do", "produces the", "produce the", "produce this",
        "give this result", "gives this result", "produces given", "gives given",
        "how is it calculated", "how did you get", "show calculation", "show derivation",
        "derivation", "why is rth", "how is rth", "current path", "physics", "principle",
        "working principle", "how it works", "tell me how", "how the current circuit"
    ])

    # Check if student is asking about a circuit explanation, mistake, or target resistance on Resistance Bank
    if analysis.get("is_resistance_bank"):
        import re
        from .circuit_analyzer import find_rb_resistor_combination, diagnose_rb_mistake, explain_rb_circuit

        # Detect if this is a mistake / why / discrepancy query
        is_mistake_query = any(w in q_lower for w in [
            "why", "getting something else", "something else", "wrong", "mistake",
            "error", "different", "not working", "not matching", "high", "low",
            "where did i go wrong", "what did i do wrong", "why is it", "why am i",
            "fault", "problem", "incorrect"
        ])

        # Extract target resistance if mentioned in question or extra_context
        target_val = None
        m = re.search(r'(\d+(?:\.\d+)?)\s*(k|kilo|m|meg)?\s*(?:ohm|r|\u03a9|\b)', q_raw, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(1))
                unit = (m.group(2) or "").lower()
                if "k" in unit:
                    v *= 1000
                elif "m" in unit and "meg" in unit:
                    v *= 1000000
                if 1 <= v <= 1000000:
                    target_val = v
            except (ValueError, TypeError):
                target_val = None

        if not target_val and getattr(context, "extra_context", None):
            extra = context.extra_context or {}
            target_val = extra.get("target_ohms")

        has_active_circuit = bool(analysis.get("active_resistors") or context.student_connections)
        # Enrich prompt with diagnostic / design hints without hardcoding the return:
        if is_mistake_query and has_active_circuit:
            diagnosis_hint = diagnose_rb_mistake(analysis, q_raw, target_ohms=target_val)
            prompt += f"\n\n[DIAGNOSTIC FINDING FOR AI TEACHER: {diagnosis_hint}. Explain the physics of why this discrepancy occurred, which resistors/jumpers caused it, and teach the student how to fix it.]\n"

        is_target_query = (
            any(w in q_lower for w in ["want", "attain", "get", "make", "obtain", "value of", "target", "need", "how to", "build"])
            or "?" in q_raw
        ) and any(w in q_lower for w in ["k", "ohm", "r", "\u03a9", "resistance"]) and target_val is not None

        if is_target_query and not is_mistake_query:
            sol = find_rb_resistor_combination(target_val)
            if sol and sol["diff"] <= (target_val * 0.15):  # within 15%
                jumper_str = f"Connect a jumper between Socket {', '.join(sol['jumpers'])}" if sol["jumpers"] else "No jumper needed"
                prompt += (
                    f"\n\n[DESIGN SYNTHESIS FOR AI TEACHER: Target is {target_val}Ω. "
                    f"Optimal verified combination on this board is {sol['topology']} combination: {sol['description']}. "
                    f"Jumpers: {jumper_str}. "
                    f"Test Terminals: Socket {sol['terminals'][0]} (Terminal A) and Socket {sol['terminals'][1]} (Terminal B). "
                    f"Achieved Rth: {sol['achieved_ohms']}Ω. Formula: {sol['formula']}. "
                    f"Guide the student through this solution step-by-step and explain the electrical physics!]\n"
                )


    is_static_query = context.mode == "theory" and not context.student_connections

    if is_static_query:
        cached = global_response_cache.get(context.experiment_name, context.student_question, provider_name)
        if cached:
            return {
                "status": "success",
                "experiment": experiment.get("experiment", context.experiment_name),
                "mode": context.mode,
                "provider": provider_name,
                "model": "cache (instant)",
                "latency_seconds": 0.001,
                "cached": True,
                "analysis": analysis,
                "prompt": prompt,
                "answer": cached,
            }

    try:
        if llm_client:
            answer = llm_client(prompt)
            return {
                "status": "success",
                "experiment": experiment.get("experiment", context.experiment_name),
                "mode": context.mode,
                "analysis": analysis,
                "prompt": prompt,
                "answer": answer,
            }
        else:
            system_prompt = getattr(mode, "SYSTEM_PROMPT", None)
            res = generate_answer_full(
                prompt=prompt,
                provider_name=context.provider,
                system_prompt=system_prompt,
            )
            if res.status != "success":
                # Check if Cloud API is configured as an automatic fallback if local Ollama is offline
                import os
                if context.provider != "api" and (os.getenv("GROQ_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")):
                    cloud_res = generate_answer_full(
                        prompt=prompt,
                        provider_name="api",
                        system_prompt=system_prompt,
                    )
                    if cloud_res.status == "success":
                        res = cloud_res

            if res.status != "success":
                # Safe pedagogical fallback if all LLM services are unavailable
                fallback_ans = None
                if analysis.get("is_resistance_bank"):
                    from .circuit_analyzer import explain_rb_circuit, diagnose_rb_mistake
                    if is_explain_query and has_active_circuit:
                        fallback_ans = explain_rb_circuit(analysis)
                    elif is_mistake_query and has_active_circuit:
                        fallback_ans = diagnose_rb_mistake(analysis, q_raw, target_ohms=target_val)
                if fallback_ans:
                    return {
                        "status": "success",
                        "experiment": experiment.get("experiment", context.experiment_name),
                        "mode": context.mode,
                        "provider": "fallback",
                        "model": "circuit-safety-fallback",
                        "latency_seconds": 0.001,
                        "analysis": analysis,
                        "prompt": prompt,
                        "answer": fallback_ans,
                    }
                return {
                    "status": "error",
                    "experiment": experiment.get("experiment", context.experiment_name),
                    "mode": context.mode,
                    "provider": res.provider,
                    "analysis": analysis,
                    "message": res.error_message or "AI generation failed.",
                }

            if is_static_query and res.content:
                global_response_cache.set(context.experiment_name, context.student_question, provider_name, res.content)

            return {
                "status": "success",
                "experiment": experiment.get("experiment", context.experiment_name),
                "mode": context.mode,
                "provider": res.provider,
                "model": res.model,
                "latency_seconds": round(res.latency_seconds, 2),
                "tokens_eval": res.tokens_eval,
                "thinking": res.thinking,
                "analysis": analysis,
                "prompt": prompt,
                "answer": res.content,
            }

    except Exception as e:
        return {
            "status": "error",
            "experiment": experiment.get(
                "experiment",
                context.experiment_name,
            ),
            "mode": context.mode,
            "analysis": analysis,
            "message": str(e),
        }