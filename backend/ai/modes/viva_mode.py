"""
modes/viva_mode.py

VivaMode: runs a viva-voce style question/answer exchange, drawing from
the experiment's documented `viva_questions` bank.

Responsibility: format a prompt that turns the LLM into an examiner
rather than a tutor - asking one question, evaluating the student's
answer, then moving on - using only the reference Q&A pairs already
present in the experiment's knowledge JSON.
"""

from typing import Any, Dict, List

from ..context import TeachingContext
from .base_mode import BaseMode


class VivaMode(BaseMode):
    """
    Conducts a viva-voce exam using the experiment's viva_questions bank.
    """

    def build(
        self,
        context: TeachingContext,
        experiment: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> str:
        """
        Build a viva-exam prompt.

        Args:
            context: Current TeachingContext. `student_question` here is
                treated as the student's answer to the most recent viva
                question, or as empty/greeting text to start the exam.
            experiment: Loaded experiment knowledge dict. Must supply
                `viva_questions` (a list of {"question", "answer"} dicts)
                for this mode to be useful; degrades gracefully if absent.
            analysis: Result of circuit_analyzer.analyze_connections().
                Accepted for interface consistency with BaseMode; not
                used by viva mode, which tests conceptual understanding
                rather than the current wiring state.

        Returns:
            Prompt string instructing the LLM to act as a viva examiner.
        """
        experiment_name = experiment.get("experiment_name", "this experiment")
        viva_questions: List[Dict[str, str]] = experiment.get("viva_questions", [])

        if viva_questions:
            bank_text = "\n".join(
                f"- Q: {q.get('question', '')}\n  Reference answer: {q.get('answer', '')}"
                for q in viva_questions
            )
        else:
            bank_text = "No viva questions documented for this experiment yet."

        prompt = f"""You are EduNexus AI Engineering Mentor, acting as a viva examiner
for a laboratory practical. Ask exactly one question at a time from the
reference bank below, evaluate the student's answer for correctness
against the reference answer, give brief feedback, then move to the next
unanswered question. Never reveal a reference answer before the student
has attempted that question.

EXPERIMENT: {experiment_name}

VIVA QUESTION BANK:
{bank_text}

STUDENT INPUT:
{context.student_question}

If the student input is empty or a greeting, begin with the first
question. Otherwise, treat it as the student's answer to the most
recently asked question and evaluate it before proceeding.
"""
        return prompt
