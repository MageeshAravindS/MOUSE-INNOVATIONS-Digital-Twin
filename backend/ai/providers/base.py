"""
backend/ai/providers/base.py

Base interface and common data structures for EduNexus LLM providers.
Enables switching between Cloud API providers (Groq, Gemini, OpenAI) and
Local Ollama (Qwen3:4B on RTX 2050).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class LLMResponse:
    """Standardized response from any LLM provider."""
    content: str
    thinking: Optional[str] = None
    provider: str = ""
    model: str = ""
    latency_seconds: float = 0.0
    tokens_eval: Optional[int] = None
    tokens_prompt: Optional[int] = None
    status: str = "success"  # "success" or "error"
    error_message: Optional[str] = None
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


class BaseLLMProvider(ABC):
    """Abstract base class for EduNexus LLM providers."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the provider (e.g. 'ollama', 'groq', 'gemini', 'openai')."""
        pass

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> LLMResponse:
        """
        Generate a text response given a user prompt and optional system prompt.
        
        Args:
            prompt: User question or structured context prompt.
            system_prompt: Guiding instructor instructions.
            options: Provider-specific inference options (temperature, num_predict, num_ctx, etc.)
            
        Returns:
            LLMResponse object.
        """
        pass

    @abstractmethod
    def health_check(self) -> Dict[str, Any]:
        """
        Check if the provider is reachable, healthy, and report hardware / model status.
        
        Returns:
            Dict containing 'available': bool, 'model': str, and diagnostics.
        """
        pass
