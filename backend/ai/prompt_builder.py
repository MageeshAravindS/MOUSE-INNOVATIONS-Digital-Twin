"""
prompt_builder.py

Builds the prompt sent to the AI Teacher (Groq LLM), turning raw
circuit-analysis results into a structured, faculty-quality prompt.

Backward compatibility notes
-----------------------------
- The function name and signature `build_prompt(experiment,
  analysis_result, student_question)` are unchanged, so no caller needs
  to change how it invokes this module.
- `experiment` may now be the fully expanded knowledge-base dict (e.g.
  the new bridge_rectifier.json) or the old minimal dict; every field is
  read with `.get(...)` and a safe fallback, so older/shorter experiment
  dicts still work without errors.
- `analysis_result` may now include the optional `group_details` key
  produced by the upgraded `circuit_analyzer.py`; if it is absent, the
  prompt simply falls back to plain group names as before.
"""

from typing import Any, Dict, List


def _format_group_list(groups) -> str:
    """Fallback formatter for a flat list of group names or lists."""
    if not groups:
        return "None"

    if isinstance(groups[0], str):
        return ", ".join(groups)

    return "\n".join(str(g) for g in groups)


def _format_list_block(items: List[str]) -> str:
    """Render a list of strings as a simple bulleted block."""
    if not items:
        return "Not specified in the experiment knowledge base."
    return "\n".join(f"- {item}" for item in items)


def _format_correct_groups(
    correct_group_names: List[str],
    group_details: Dict[str, Any],
) -> str:
    """
    Render matched groups with full component context when available,
    otherwise fall back to a plain group-name list.
    """
    if not correct_group_names:
        return "None"

    if not group_details:
        return _format_group_list(correct_group_names)

    lines = []
    for name in correct_group_names:
        detail = group_details.get(name)
        if not detail:
            lines.append(f"- {name}: (no metadata available)")
            continue
        nodes_display = detail.get("matched_nodes_named") or detail.get(
            "matched_nodes", detail.get("expected_nodes", [])
        )
        lines.append(
            f"- {name} | Component: {detail.get('component_name', 'Unknown')} "
            f"| Nodes: {nodes_display} "
            f"| Purpose: {detail.get('purpose', 'Not specified')}"
        )
    return "\n".join(lines)


def _format_missing_groups(
    missing_group_names: List[str],
    group_details: Dict[str, Any],
) -> str:
    """
    Render missing groups with the component name, expected nodes, and
    practical consequence, so the AI can explain WHY it matters instead
    of just stating that it is missing.
    """
    if not missing_group_names:
        return "None"

    if not group_details:
        return _format_group_list(missing_group_names)

    lines = []
    for name in missing_group_names:
        detail = group_details.get(name)
        if not detail:
            lines.append(f"- {name}: (no metadata available)")
            continue
        nodes_display = detail.get("expected_nodes_named") or detail.get(
            "expected_nodes", []
        )
        lines.append(
            f"- {name} | Component: {detail.get('component_name', 'Unknown')} "
            f"| Expected Nodes: {nodes_display} "
            f"| Effect if Missing: {detail.get('effect_if_missing', 'Not specified')} "
            f"| Correction: {detail.get('next_step', 'Not specified')}"
        )
    return "\n".join(lines)


def _format_wrong_groups(wrong_groups: List[List[str]]) -> str:
    """Render extra/unrecognized student groups as raw node lists."""
    if not wrong_groups:
        return "None"
    return "\n".join(f"- Unrecognized wiring: {group}" for group in wrong_groups)


def _format_next_missing_group(
    missing_group_names: List[str],
    group_details: Dict[str, Any],
) -> str:
    """
    Render ONLY the first missing group (the next one the student should
    fix), with its component, required nodes, and purpose. Returns a
    message saying nothing is missing if the list is empty.
    """
    if not missing_group_names:
        return "None - no missing groups."

    name = missing_group_names[0]
    detail = group_details.get(name, {}) if group_details else {}
    nodes_display = detail.get("expected_nodes_named") or detail.get(
        "expected_nodes", []
    )
    nodes_arrow = " -> ".join(str(n) for n in nodes_display) if nodes_display else "Not specified"

    return (
        f"Group {name}\n"
        f"Component: {detail.get('component_name', 'Unknown')}\n"
        f"Required Nodes:\n{nodes_arrow}\n"
        f"Purpose:\n{detail.get('purpose') or detail.get('description') or 'Not specified in the experiment knowledge base.'}\n"
        f"Effect if Missing: {detail.get('effect_if_missing', 'Not specified')}\n"
        f"Correction: {detail.get('next_step', 'Not specified')}"
    )


def build_prompt(
    experiment: Dict[str, Any],
    analysis_result: Dict[str, Any],
    student_question: str,
) -> str:

    # --- Pull experiment knowledge (all optional, all safely defaulted) ---
    experiment_name = experiment.get("experiment", "Unknown Experiment")
    aim = experiment.get("aim", "")
    theory = experiment.get("theory", "")
    working_principle = experiment.get("working_principle", "")
    precautions = experiment.get("precautions", [])
    expected_voltage = experiment.get("expected_voltage", {})
    expected_waveforms = experiment.get("expected_waveforms", [])
    troubleshooting = experiment.get("troubleshooting", [])
    resistors_list = experiment.get("resistors", [])
    resistors_text = "\n".join(
        f"- {r.get('id', '')} ({r.get('label') or r.get('name', '')}): {r.get('ohms')}Ω (Sockets {r.get('sockets', ['?','?'])[0]}-{r.get('sockets', ['?','?'])[1]})"
        for r in resistors_list
    ) if resistors_list else ""

    # --- Pull analysis results (all optional, all safely defaulted) ---
    summary = analysis_result.get("summary", {})
    correct = analysis_result.get("correct_groups", [])
    missing = analysis_result.get("missing_groups", [])
    wrong = analysis_result.get("wrong_groups", [])
    group_details = analysis_result.get("group_details", {})

    # NEW
    detected_groups = analysis_result.get(
        "detected_connection_groups",
        []
    )

    expected_voltage_text = (
        f"No-filter: {expected_voltage.get('formula_no_filter', 'N/A')} | "
        f"With filter: {expected_voltage.get('formula_with_filter', 'N/A')} | "
        f"Typical value: {expected_voltage.get('typical_value', 'N/A')}"
        if expected_voltage
        else "Not specified in the experiment knowledge base."
    )

    troubleshooting_text = (
        "\n".join(
            f"- Symptom: {t.get('symptom', '')} | Likely Cause: {t.get('likely_cause', '')} "
            f"| Fix: {t.get('fix', '')}"
            for t in troubleshooting
        )
        if troubleshooting
        else "Not specified in the experiment knowledge base."
    )
    # Format the detected connection groups for the AI prompt
    if detected_groups:
        detected_groups_text = "\n".join(
            f"- {' - '.join(str(x) for x in group)}"
            for group in detected_groups
        )
    else:
        detected_groups_text = "No connection groups detected."

    circuit_complete = (
        summary.get("expected", 0) > 0
        and summary.get("missing", 0) == 0
        and summary.get("wrong", 0) == 0
    )
    completion_status_text = (
        "COMPLETE - all expected groups are correctly wired."
        if circuit_complete
        else "INCOMPLETE - one or more expected groups are missing or wired incorrectly."
    )
    no_live_data_note = (
        ""
        if detected_groups
        else (
            "\nNOTE: No live hardware connections were detected. If the student explicitly asks about their circuit or wiring, inform them that no connections were detected.\n"
        )
    )

    all_correct = circuit_complete
    next_group_block = _format_next_missing_group(missing, group_details)

    if analysis_result.get("is_resistance_bank"):
        active_r = analysis_result.get("active_resistors", [])
        active_r_text = "\n".join(
            f"- {r['label']} ({r['ohms']}Ω, Sockets {r['sockets'][0]}-{r['sockets'][1]}){' [SHORTED]' if r.get('shorted') else ''}"
            for r in active_r
        ) if active_r else "No resistors connected yet."
        rth_val = analysis_result.get("equivalent_resistance_ohms")
        rth_str = f"{rth_val} Ω" if rth_val is not None else "Open circuit / not measurable"
        term_a = analysis_result.get("terminal_a", "N/A")
        term_b = analysis_result.get("terminal_b", "N/A")
        topology_str = analysis_result.get("topology", "none").replace("_", "-").upper()
        
        prompt = f"""----------------------------------------
LIVE EXPERIMENT STATUS: RESISTANCE BANK TRAINER
----------------------------------------
Detected Jumper Connections:
{detected_groups_text}

Active Resistors Wired:
{active_r_text}

Network Topology: {topology_str}
Identified Measurement Terminals: Terminal A = Socket {term_a}, Terminal B = Socket {term_b}
Calculated Equivalent Resistance (Rth): {rth_str}
Short Circuit Warnings: {', '.join(analysis_result.get('short_circuits', [])) or 'None'}

Circuit Analysis Summary:
{analysis_result.get('network_summary', '')}

Available Precision Resistors on Board:
{resistors_text}

----------------------------------------
STUDENT QUESTION:
{student_question}
----------------------------------------

INSTRUCTOR GUIDELINES:
- If the student asks to EXPLAIN how the circuit produces the result or why Rth has this value: Provide a step-by-step pedagogical explanation:
  1. Circuit Configuration & Active Wiring (which resistors and jumpers are wired)
  2. Physical Current Path (trace electron flow from Terminal A to Terminal B)
  3. Mathematical Derivation (apply Kirchhoff's Voltage/Current Laws: e.g. Rth = R1 + R2)
  4. Multimeter Measurement Principle (why the meter measures this exact equivalent value)
- If the student asks how to attain or design a target resistance: Look at Available Precision Resistors above, calculate the series/parallel combination, state the exact sockets to jumper, and specify measurement terminals.
- If the student asks about connection status: Summarize the active network and measurement endpoints.
- If casual chat or greeting: Answer warmly and naturally.

Keep your internal reasoning focused and concise, then output your complete student explanation."""
        return prompt
    else:
        live_status_block = f"""----------------------------------------
LIVE EXPERIMENT STATUS (use ONLY for Category C questions)
----------------------------------------

Detected Connection Groups:
{detected_groups_text}

Correct Groups:
{_format_correct_groups(correct, group_details)}

Missing Groups:
{_format_missing_groups(missing, group_details)}

Next Group to Complete:
{next_group_block}

Wrong / Unrecognized Groups:
{_format_wrong_groups(wrong)}

Circuit Completion Status: {completion_status_text}
All Groups Correct: {"Yes" if all_correct else "No"}

Summary:
- Expected Groups : {summary.get("expected", 0)}
- Correct Groups  : {summary.get("correct", 0)}
- Missing Groups  : {summary.get("missing", 0)}
- Wrong Groups    : {summary.get("wrong", 0)}
"""

    resistors_block = f"Available Resistors on this Board:\n{resistors_text}\n" if resistors_text else ""

    prompt = f"""
You are an AI Electrical Laboratory Instructor for EduNexus — a friendly,
knowledgeable engineering lab mentor. You are CONVERSATIONAL and respond
naturally to whatever the student asks.

CRITICAL RULE — CLASSIFY THE QUESTION FIRST:
Before responding, classify the student's message into one of these
categories:

A) GREETING / CASUAL (e.g. "Hi", "Hello", "How are you?", "Thanks")
   → Respond warmly and briefly like a friendly professor. Do NOT
     mention wiring analysis, connection groups, or experiment status.
     Just be human and welcoming. Example: "Hey! I'm your lab instructor.
     What would you like to learn about today?"

B) THEORY / CIRCUIT EXPLANATION / DESIGN / TARGET RESISTANCE (e.g. "explain how the current circuit produces the given result",
   "how does this circuit work?", "why is Rth 1047?", "I want 11.4k resistance what would be the best approach", "What is a bridge rectifier?")
   → Answer directly with physical principles and step-by-step mathematical derivation!
     - If the student asks to EXPLAIN how their circuit produces the result or why Rth has a specific value:
       Explain the physical current flow (unbranched path for series, branching at nodes for parallel), cite Kirchhoff's Laws (KVL/KCL), write out the mathematical derivation step-by-step with active component numbers, and explain the measurement endpoints.
       NEVER just tell the student to enter values or click 'Check Answer' when they ask for an explanation!
     - If the student asks how to attain a specific resistance (e.g. 11.4k): Look at the Available Resistors on this Board below. Calculate the exact series/parallel combination (e.g. R3 4.7K in series with R5 6.7K gives exactly 11.4kΩ!). Provide the exact socket numbers to jumper (e.g. connect Socket 16 to Socket 9, and measure across Sockets 15 and 10).
     - Do NOT just dump the current board wiring analysis if they are asking how to build or achieve a specific value!

C) WIRING / CIRCUIT CHECK (e.g. "Check my wiring", "Is my circuit
   correct?", "What should I connect next?", "Analyze my connections", "check my connection now?")
   → ONLY FOR THIS CATEGORY: Use the LIVE EXPERIMENT STATUS below.
     - For Resistance Bank: State what jumpers and resistors are connected, what the network topology is (series/parallel), what the calculated equivalent resistance Rth is, and what terminals to test in the practical evaluation card.
     - For Rectifiers: State what connection groups are detected, which group to wire next, and the concrete next action.
     - Keep under 150 words.

D) VIVA / EXAM QUESTION (e.g. "Give me a viva question", "Test me")
   → Ask one relevant viva question about the experiment, then evaluate
     their answer when they respond.

E) OTHER (anything else)
   → Answer helpfully using your electrical engineering knowledge and
     the experiment context. Be concise, friendly, and mentor-like.

GENERAL RULES (apply to ALL categories):
- Keep responses SHORT and READABLE. Use headings and bullet points.
- Never invent wiring data. If no connections are detected, say so
  only when the student asks about their circuit (Category C).
- Never hallucinate components, node numbers, or readings.
- Be encouraging and mentor-like, not robotic.
- Keep under 150 words unless the student explicitly asks for detail.
{no_live_data_note}
{live_status_block}

----------------------------------------
EXPERIMENT KNOWLEDGE: {experiment_name}
----------------------------------------

Aim:
{aim if aim else "Not specified in the experiment knowledge base."}

Theory:
{theory if theory else "Not specified in the experiment knowledge base."}

Working Principle:
{working_principle if working_principle else "Not specified in the experiment knowledge base."}

{resistors_block}
Precautions:
{_format_list_block(precautions)}

Expected Voltage:
{expected_voltage_text}

Expected Waveforms:
{_format_list_block(expected_waveforms)}

Common Troubleshooting Reference:
{troubleshooting_text}

----------------------------------------
STUDENT QUESTION
----------------------------------------

{student_question}

----------------------------------------

Classify the question (A/B/C/D/E) and respond accordingly. Do NOT
force wiring analysis on greetings, theory questions, or casual chat.
"""

    return prompt