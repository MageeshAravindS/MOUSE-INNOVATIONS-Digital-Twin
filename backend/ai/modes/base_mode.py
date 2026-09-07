"""
modes/base_mode.py

Defines BaseMode: the abstract interface every teaching mode must
implement.

A mode's single responsibility is prompt construction: given the current
TeachingContext plus the already-loaded experiment knowledge and
already-computed circuit analysis, produce a prompt string for the LLM.

A mode must NOT:
    - read files (that's experiment_loader's job)
    - compare wiring (that's circuit_analyzer's job)
    - call the LLM (that's ai_teacher's job)

This separation means adding a new mode later (e.g. a future
waveform_mode) requires only a new file implementing this interface -
no changes to ai_teacher.py, circuit_analyzer.py, or experiment_loader.py.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict

from ..context import TeachingContext


class BaseMode(ABC):
    """Abstract base class for a single teaching mode."""

    @abstractmethod
    def build(
        self,
        context: TeachingContext,
        experiment: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> str:
        """
        Build the LLM prompt for this mode.

        Args:
            context: The current TeachingContext (question, wiring, mode, etc.).
            experiment: Dict returned by experiment_loader.load_experiment().
            analysis: Dict returned by circuit_analyzer.analyze_connections().

        Returns:
            A complete prompt string ready to send to an LLM client.
        """
        raise NotImplementedError
