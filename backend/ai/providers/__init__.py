"""
backend/ai/providers/__init__.py

Provider factory for EduNexus AI Teacher.
"""

import os
from typing import Optional

from .api_provider import APIProvider
from .base import BaseLLMProvider, LLMResponse
from .ollama_provider import OllamaProvider


def get_provider(name: Optional[str] = None) -> BaseLLMProvider:
    """
    Get the configured or requested LLM provider instance.
    
    Args:
        name: 'ollama' / 'local' or 'api' / 'groq' / 'gemini' / 'openai' or None (reads .env)
    """
    if not name:
        name = os.getenv("LLM_PROVIDER", "ollama").lower().strip()

    name = name.lower().strip()
    if name in {"ollama", "local", "qwen3", "qwen"}:
        return OllamaProvider()
    elif name in {"api", "groq", "gemini", "openai", "cloud"}:
        return APIProvider()
    else:
        # Default to Ollama for local-first architecture
        return OllamaProvider()


__all__ = ["BaseLLMProvider", "LLMResponse", "OllamaProvider", "APIProvider", "get_provider"]
