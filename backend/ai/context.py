"""
context.py

Defines TeachingContext: a single data container passed through the AI
teacher pipeline (loader -> analyzer -> mode -> LLM).

Design rationale: without this, every new capability (hardware readings,
student history, viva mode, ...) would mean adding another positional
parameter to ai_teacher.get_ai_teacher_answer(), which breaks the
Open/Closed Principle. With TeachingContext, new capabilities are added
as new fields here, and nothing else in the pipeline has to change its
signature.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

# Modes currently supported. Kept as a module-level constant (rather than
# an Enum) so new modes can be added by updating this one line, without
# introducing an extra import for callers.
VALID_MODES = {"theory", "experiment", "viva", "evaluator", "circuit_evaluator"}


@dataclass
class TeachingContext:
    """
    Carries everything needed to answer one student question or evaluate a circuit.
    """

    experiment_name: str
    student_connections: Sequence[Sequence[Any]] = field(default_factory=list)
    student_question: str = ""
    student_id: Optional[str] = None
    mode: str = "experiment"
    provider: Optional[str] = None  # "ollama" / "api" / None (default from .env)
    student_level: str = "intermediate"
    previous_errors: Optional[List[str]] = None
    live_readings: Optional[Dict[str, Any]] = None
    history: Optional[List[Any]] = None
    extra_context: Optional[Dict[str, Any]] = None

    def __post_init__(self) -> None:
        if self.mode not in VALID_MODES:
            raise ValueError(
                f"Invalid mode '{self.mode}'. Must be one of {sorted(VALID_MODES)}."
            )
        if not self.experiment_name:
            raise ValueError("experiment_name must be a non-empty string.")
