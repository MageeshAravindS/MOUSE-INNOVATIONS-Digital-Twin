"""
backend/ai/modes/evaluator_mode.py

EvaluatorMode: Implements Level 2 circuit interpretation for Qwen3:4B.
Receives compact structured circuit state from Level 1 deterministic analyzer,
and outputs standardized, student-friendly circuit guidance.
Enforces the safety hierarchy: Level 1 deterministic safety is always authoritative.
"""

import json
from typing import Any, Dict, List

from ..context import TeachingContext
from .base_mode import BaseMode


class EvaluatorMode(BaseMode):
    """
    Interprets circuit wiring and produces actionable, debounced guidance
    in the required Problem / Why / Fix / Try again structure.
    """

    SYSTEM_PROMPT = (
        "You are the EduNexus AI Circuit Evaluator and Lab Safety Mentor. "
        "Your task is to examine the student's circuit wiring analysis and provide "
        "extremely concise, clear, and actionable feedback.\n\n"
        "RESPONSE RULES:\n"
        "1. If there is a SAFETY HAZARD (e.g. short circuit, direct supply loop): "
        "Begin with 🛑 SAFETY WARNING in bold, order mains power OFF immediately, and explain the danger.\n"
        "2. If the circuit has ERRORS or MISSING BRANCHES, output EXACTLY this format:\n"
        "⚠️ Problem\n"
        "[1-2 sentence description of the exact mistake or missing connection]\n\n"
        "Why\n"
        "[1-2 sentence fundamental electrical explanation of why this matters]\n\n"
        "Fix\n"
        "[One concrete, specific step detailing which nodes/components to connect or move]\n\n"
        "Try again.\n\n"
        "3. If all expected connections are CORRECT and complete:\n"
        "✓ Circuit looks correct.\n"
        "[One sentence on what to observe next on the CRO or multimeter]\n"
        "You can proceed with the experiment.\n\n"
        "4. If NO connections have been placed yet:\n"
        "⚠️ Circuit Incomplete\n"
        "Connect the first branch to begin: [First missing group nodes and component].\n\n"
        "5. NEVER hallucinate components, node IDs, or measurements. Use ONLY the provided circuit data. "
        "Keep total response under 100 words."
    )

    def build(
        self,
        context: TeachingContext,
        experiment: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> str:
        """
        Build a compact, structured prompt for circuit evaluation.
        """
        experiment_name = experiment.get("experiment_name", context.experiment_name)
        summary = analysis.get("summary", {})
        missing_groups = analysis.get("missing_groups", [])
        wrong_groups = analysis.get("wrong_groups", [])
        correct_groups = analysis.get("correct_groups", [])
        group_details = analysis.get("group_details", {})

        if analysis.get("is_resistance_bank"):
            shorted = analysis.get("short_circuits", [])
            rth = analysis.get("equivalent_resistance_ohms")
            compact_state = {
                "experiment": "Resistance Bank Trainer",
                "status": "correct" if analysis.get("active_resistors") and not shorted else "hazard" if shorted else "incomplete",
                "active_resistors": [r["label"] for r in analysis.get("active_resistors", [])],
                "topology": analysis.get("topology"),
                "short_circuits": shorted,
                "terminal_a": analysis.get("terminal_a"),
                "terminal_b": analysis.get("terminal_b"),
                "equivalent_resistance_ohms": rth,
                "first_action_needed": analysis.get("next_step"),
            }
        else:
            # Compact structured data
            compact_state = {
                "experiment": experiment_name,
                "status": "correct" if summary.get("expected", 0) > 0 and not missing_groups and not wrong_groups else "incorrect" if wrong_groups else "incomplete",
                "summary": {
                    "total_expected": summary.get("expected", 0),
                    "correct_count": len(correct_groups),
                    "missing_count": len(missing_groups),
                    "wrong_count": len(wrong_groups),
                },
                "missing_groups": [],
                "wrong_groups": [],
                "first_action_needed": None,
            }

        # Populate top priority missing/wrong
        if missing_groups:
            first_m = missing_groups[0]
            m_detail = group_details.get(first_m, {})
            compact_state["missing_groups"] = [
                {
                    "group_id": first_m,
                    "component": m_detail.get("component_name", first_m),
                    "expected_nodes": m_detail.get("expected_nodes_named") or m_detail.get("expected_nodes", []),
                    "purpose": m_detail.get("purpose", ""),
                    "effect_if_missing": m_detail.get("effect_if_missing", ""),
                }
            ]
            compact_state["first_action_needed"] = f"Connect {first_m}: {m_detail.get('component_name', '')} (Nodes: {', '.join(str(n) for n in m_detail.get('expected_nodes', []))})"

        if wrong_groups:
            compact_state["wrong_groups"] = wrong_groups[:2]

        # Student adaptation (Section 16)
        student_info = ""
        if context.previous_errors:
            student_info = f"\nStudent has repeated these errors previously: {', '.join(context.previous_errors)}."

        prompt = (
            f"EVALUATE CIRCUIT STATE:\n"
            f"```json\n"
            f"{json.dumps(compact_state, indent=2)}\n"
            f"```\n"
            f"{student_info}\n"
            f"Student note/question: {context.student_question or 'Evaluate my current circuit.'}\n"
            f"Provide circuit guidance following the required response rules."
        )

        return prompt

    @staticmethod
    def format_deterministic(analysis: Dict[str, Any]) -> str:
        """
        Produces standardized Level 1 circuit evaluation guidance deterministically,
        without invoking the LLM. Extremely fast (< 1ms) and 100% accurate.
        """
        if analysis.get("is_resistance_bank"):
            shorted = analysis.get("short_circuits", [])
            active = analysis.get("active_resistors", [])
            rth = analysis.get("equivalent_resistance_ohms")
            top = (analysis.get("topology") or "series").upper()
            tA = analysis.get("terminal_a")
            tB = analysis.get("terminal_b")

            if shorted:
                short_labels = ", ".join(s.get("resistor", "component") for s in shorted)
                return (
                    f"🛑 SAFETY WARNING\n"
                    f"Short circuit detected across {short_labels}!\n\n"
                    f"Why\n"
                    f"Both terminals of the same resistor are connected directly together, bypassing the component.\n\n"
                    f"Fix\n"
                    f"Disconnect the shorting jumper patch cord.\n\n"
                    f"Try again."
                )

            if not active:
                return (
                    "⚠️ Circuit Incomplete\n"
                    "Select two or more resistors and connect jumper patch cords between their terminal sockets to build a network."
                )

            res_names = ", ".join(r["label"] for r in active)
            rth_str = f"{rth:.1f} Ω" if rth is not None else "Open circuit"
            term_info = f" between Terminal {tA} and Terminal {tB}" if (tA and tB) else ""
            return (
                f"✓ Circuit looks correct.\n"
                f"Active resistors: {res_names} ({top} network). Hand-calculated equivalent resistance Rth = {rth_str}{term_info}.\n"
                f"You can proceed with the experiment."
            )

        # Standard Power Converter / Rectifier experiments
        summary = analysis.get("summary", {})
        missing = analysis.get("missing_groups", [])
        wrong = analysis.get("wrong_groups", [])
        details = analysis.get("group_details", {})

        if summary.get("expected", 0) > 0 and not missing and not wrong:
            return (
                "✓ Circuit looks correct.\n"
                "All expected circuit connections are complete. You can proceed with the experiment."
            )

        if not missing and not wrong and summary.get("expected", 0) == 0:
            return (
                "⚠️ Circuit Incomplete\n"
                "Connect the first branch according to the experiment schematic to begin."
            )

        if wrong:
            first_w = wrong[0]
            w_nodes = ", ".join(str(n) for n in first_w.get("nodes", [])) if isinstance(first_w, dict) else str(first_w)
            return (
                f"⚠️ Problem\n"
                f"Incorrect connection detected linking nodes: {w_nodes}.\n\n"
                f"Why\n"
                f"These nodes should not be joined according to the schematic.\n\n"
                f"Fix\n"
                f"Disconnect this wire and double check the terminal numbers.\n\n"
                f"Try again."
            )

        if missing:
            first_m = missing[0]
            m_detail = details.get(first_m, {})
            comp_name = m_detail.get("component_name", first_m)
            exp_nodes = ", ".join(str(n) for n in m_detail.get("expected_nodes", []))
            purpose = m_detail.get("purpose", "Completes the circuit loop.")
            return (
                f"⚠️ Problem\n"
                f"Missing connection for {comp_name}.\n\n"
                f"Why\n"
                f"{purpose}\n\n"
                f"Fix\n"
                f"Connect {comp_name} across terminals {exp_nodes}.\n\n"
                f"Try again."
            )

        return "⚠️ Circuit Incomplete\nConnect the circuit components according to the schematic."

