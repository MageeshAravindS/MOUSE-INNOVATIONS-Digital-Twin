"""
modes/experiment_mode.py

ExperimentMode: the default teaching mode, used when a student asks about
their current wiring or overall experiment progress.

Responsibility: format a prompt that centers on the circuit analysis
(correct / missing / extra connections) so the LLM answers with reference
to what the student has actually wired, not a generic explanation.

Reuses prompt_builder.build_prompt() for the core experiment/connection
formatting rather than duplicating it, so that connection-formatting
logic continues to live in exactly one place (prompt_builder.py).
"""

from typing import Any, Dict

from ..context import TeachingContext
from ..prompt_builder import build_prompt
from .base_mode import BaseMode


class ExperimentMode(BaseMode):
    """
    Guides the student through their current wiring attempt, referencing
    the live circuit analysis.
    """

    SYSTEM_PROMPT = (
        "You are the EduNexus AI Practical Laboratory Instructor at Mouse Innovations — an expert, encouraging electrical engineering mentor.\n\n"
        "CORE TEACHING PRINCIPLES:\n"
        "1. THINK STEP-BY-STEP THROUGH THE CIRCUIT:\n"
        "   - Inspect the active resistors, socket terminal numbers, and jumper patch cords.\n"
        "   - Trace the physical path of electric charge from Terminal A to Terminal B.\n"
        "   - Determine if the circuit topology is Series (unbranched path) or Parallel (shared node pair).\n"
        "   - Apply the governing physical law: Kirchhoff's Voltage Law (KVL for series: Rth = R1 + R2) or Kirchhoff's Current Law (KCL for parallel: 1/Rth = 1/R1 + 1/R2).\n"
        "   - Show the step-by-step mathematical substitution with actual numbers and units.\n"
        "2. NEVER OUTPUT ROBOTIC COMMAND TEMPLATES:\n"
        "   - Never just command the student to enter values or click 'Check Answer' when asked for an explanation. Explain the physics, the current path, and why the multimeter measures that specific value.\n"
        "3. CLEAR PEDAGOGICAL STRUCTURE:\n"
        "   - Use clean markdown with bold section headers and bullet points so engineering students can learn effectively."
    )

    #: Appended after the shared prompt_builder output
    _MODE_INSTRUCTIONS = (
        "\nINSTRUCTOR INSTRUCTIONS:\n"
        "You are the laboratory instructor. Always prioritize answering the student's specific question or request directly first!\n"
        "- If they ask to EXPLAIN how the circuit produces the result (e.g. 'explain how the current circuit produces the given result', 'how does this circuit work'): Provide the physical current path, state Kirchhoff's Voltage/Current Laws, and show the step-by-step mathematical derivation ($R_{th} = R_1 + R_2 = ...$). Never just command them to enter values or click 'Check Answer'.\n"
        "- If they ask how to achieve a specific target resistance (e.g. 'I want 11.4k' or 'how to get X resistance'): Calculate and provide the exact combination of resistors and socket jumpers on this board to attain that value (e.g., 4.7K [Sockets 15-16] in series with 6.7K [Sockets 9-10] gives exactly 11.4kΩ via jumper 16-9).\n"
        "- If they ask about connection status or wiring (e.g. 'Check my wiring', 'What is connected?'): Refer to the live circuit analysis above, state the active resistors, topology, theoretical Rth, and measurement terminals.\n"
        "- If they ask a concept, calculation, or conversational question: Answer it warmly, helpfully, and concisely.\n"
        "Always output only your direct response to the student without internal deliberations.\n"
    )

    def build(
        self,
        context: TeachingContext,
        experiment: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> str:
        """
        Build an experiment-guidance prompt.

        Args:
            context: Current TeachingContext. Only `student_question` is
                used directly here; `student_connections` has already been
                consumed upstream by circuit_analyzer to produce `analysis`.
            experiment: Loaded experiment knowledge dict.
            analysis: Result of circuit_analyzer.analyze_connections().

        Returns:
            Prompt string combining the shared experiment/analysis
            formatting with experiment-mode-specific instructions.
        """
        base_prompt = build_prompt(experiment, analysis, context.student_question)
        return base_prompt + self._MODE_INSTRUCTIONS
