"""
modes/theory_mode.py

TheoryMode: used when the student wants a concept explained, independent
of their current wiring state (e.g. "why do we need a filter capacitor?").

Responsibility: format a prompt centered on the experiment's theory
block, de-emphasizing circuit analysis so the LLM doesn't drift into
wiring feedback when the student just wants a concept explained.
"""

from typing import Any, Dict, List

from ..context import TeachingContext
from .base_mode import BaseMode


class TheoryMode(BaseMode):
    """
    Explains the underlying theory of an experiment: definition, working
    principle, formulas, and real-world applications.
    """

    def build(
        self,
        context: TeachingContext,
        experiment: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> str:
        """
        Build a theory-explanation prompt.

        Args:
            context: Current TeachingContext (uses `student_question` only).
            experiment: Loaded experiment knowledge dict.
            analysis: Result of circuit_analyzer.analyze_connections().
                Accepted for interface consistency with BaseMode, but only
                referenced in the prompt as optional context, not the focus.

        Returns:
            Prompt string focused on theory rather than wiring state.
        """
        experiment_name = experiment.get("experiment_name", "this experiment")
        theory_raw = experiment.get("theory", {})
        if isinstance(theory_raw, dict):
            overview = theory_raw.get("overview", "No theory overview available.")
            applications = theory_raw.get("applications", [])
        elif isinstance(theory_raw, str):
            overview = theory_raw
            applications = experiment.get("practical_applications", [])
        else:
            overview = "No theory overview available."
            applications = []

        applications_text = (
            ", ".join(applications) if applications else "Not documented."
        )

        wiring_note = ""
        if analysis.get("summary", {}).get("student", 0) > 0:
            # The student has wired something, but this is theory mode -
            # mention it exists without making it the focus.
            wiring_note = (
                "\n(The student has an in-progress wiring attempt on the "
                "board, but only reference it if their question asks about "
                "their specific circuit.)\n"
            )

        prompt = f"""You are EduNexus AI Engineering Mentor, acting as an engineering
professor. Explain concepts clearly and in this order where relevant:
1. Definition
2. Working principle
3. Circuit explanation
4. Formula
5. Expected waveform
6. Real industrial application

EXPERIMENT: {experiment_name}

THEORY OVERVIEW:
{overview}

REAL-WORLD APPLICATIONS:
{applications_text}
{wiring_note}
STUDENT QUESTION:
{context.student_question}

Answer as a theory explanation, not a wiring review.
"""
        return prompt
