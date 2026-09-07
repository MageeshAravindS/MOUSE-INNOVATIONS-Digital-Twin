"""
backend/ai/providers/api_provider.py

Cloud API provider for EduNexus AI Teacher.
Supports Groq, Google Gemini, and OpenAI with auto-detection, dynamic .env reload,
and fallback handling.
"""

import json
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger("edunexus.ai.api_provider")


class APIProvider(BaseLLMProvider):
    """
    Cloud API provider supporting Groq, Gemini, and OpenAI.
    """

    def __init__(self, timeout: float = 30.0):
        self.default_timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", str(timeout)))

    @property
    def provider_name(self) -> str:
        provider, _ = self._get_active_provider_and_key()
        return provider or "api_unconfigured"

    def _reload_env(self) -> None:
        env_paths = [
            os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
            os.path.join(os.getcwd(), "backend", ".env"),
            os.path.join(os.getcwd(), ".env"),
        ]
        for p in env_paths:
            if os.path.isfile(p):
                load_dotenv(p, override=True)
                break
        else:
            load_dotenv(override=True)

    def _get_active_provider_and_key(self) -> Tuple[Optional[str], Optional[str]]:
        self._reload_env()
        explicit = os.getenv("LLM_PROVIDER", "").lower().strip()
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()

        if explicit == "gemini" and gemini_key:
            return "gemini", gemini_key
        if explicit == "groq" and groq_key:
            return "groq", groq_key
        if explicit == "openai" and openai_key:
            return "openai", openai_key

        if groq_key:
            return "groq", groq_key
        if gemini_key:
            return "gemini", gemini_key
        if openai_key:
            return "openai", openai_key

        return None, None

    def health_check(self) -> Dict[str, Any]:
        provider, key = self._get_active_provider_and_key()
        if not provider or not key:
            return {
                "available": False,
                "provider": "none",
                "status": "missing_api_key",
                "error": "No valid API key (GROQ_API_KEY or GEMINI_API_KEY) found in backend/.env",
            }
        
        masked_key = f"{key[:7]}...{key[-4:]}" if len(key) > 12 else "***"
        model = os.getenv("GROQ_MODEL" if provider == "groq" else f"{provider.upper()}_MODEL", "default")
        return {
            "available": True,
            "provider": provider,
            "model": model,
            "key_present": True,
            "key_masked": masked_key,
            "status": "ready",
        }

    def _call_groq(self, key: str, prompt: str, system_prompt: Optional[str], timeout: float) -> Tuple[str, Dict[str, Any]]:
        from groq import Groq
        model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        client = Groq(api_key=key, timeout=timeout)
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.3,
            max_tokens=1024,
        )
        content = resp.choices[0].message.content.strip() if resp.choices else ""
        meta = {
            "model": model,
            "prompt_tokens": getattr(resp.usage, "prompt_tokens", None),
            "completion_tokens": getattr(resp.usage, "completion_tokens", None),
        }
        return content, meta

    def _call_gemini(self, key: str, prompt: str, system_prompt: Optional[str], timeout: float) -> Tuple[str, Dict[str, Any]]:
        import requests
        model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return "", {"model": model}
        content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        return content, {"model": model}

    def _call_openai(self, key: str, prompt: str, system_prompt: Optional[str], timeout: float) -> Tuple[str, Dict[str, Any]]:
        import requests
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        url = "https://api.openai.com/v1/chat/completions"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        resp = requests.post(
            url,
            json={"model": model, "messages": messages, "temperature": 0.3, "max_tokens": 1024},
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        return content, {"model": model}

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> LLMResponse:
        provider, key = self._get_active_provider_and_key()
        if not provider or not key:
            return LLMResponse(
                content="",
                provider="none",
                status="error",
                error_message="Missing API Key in backend/.env. Configure GROQ_API_KEY or GEMINI_API_KEY.",
            )

        timeout = float((options or {}).get("timeout", self.default_timeout))
        t0 = time.time()

        try:
            if provider == "groq":
                content, meta = self._call_groq(key, prompt, system_prompt, timeout)
            elif provider == "gemini":
                content, meta = self._call_gemini(key, prompt, system_prompt, timeout)
            elif provider == "openai":
                content, meta = self._call_openai(key, prompt, system_prompt, timeout)
            else:
                return LLMResponse(
                    content="",
                    provider=provider,
                    status="error",
                    error_message=f"Unsupported provider: {provider}",
                )

            latency = time.time() - t0
            return LLMResponse(
                content=content,
                provider=provider,
                model=meta.get("model", provider),
                latency_seconds=latency,
                tokens_prompt=meta.get("prompt_tokens"),
                tokens_eval=meta.get("completion_tokens"),
                status="success",
            )
        except Exception as e:
            latency = time.time() - t0
            return LLMResponse(
                content="",
                provider=provider,
                latency_seconds=latency,
                status="error",
                error_message=f"API generation error ({provider}): {str(e)}",
            )
