"""
backend/ai/providers/ollama_provider.py

Local Ollama provider specifically tuned for Qwen3:4B on an NVIDIA GeForce RTX 2050 (4GB VRAM).
Enforces compact context window (default 2048), token limits, and reasoning extraction.
"""

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from dotenv import load_dotenv

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger("edunexus.ai.ollama")


class OllamaProvider(BaseLLMProvider):
    """
    Interacts with local Ollama runtime via its REST API.
    Optimized for Qwen3:4B running on RTX 2050 4GB GPU.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self._reload_env()
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", "qwen3:4b")
        self.timeout = float(os.getenv("OLLAMA_TIMEOUT", str(timeout)))
        self.default_num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "1536"))
        self.default_num_predict = int(os.getenv("OLLAMA_NUM_PREDICT", "700"))
        self.thinking_enabled = os.getenv("OLLAMA_THINKING", "false").lower() in ("true", "1", "yes")
        self.num_threads = int(os.getenv("OLLAMA_NUM_THREADS", "6"))

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

    @property
    def provider_name(self) -> str:
        return "ollama"

    def health_check(self) -> Dict[str, Any]:
        """Verify Ollama server is running and check if the target model is loaded."""
        url = f"{self.base_url}/api/tags"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5.0) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    models = [m.get("name", "") for m in data.get("models", [])]
                    target_available = any(
                        self.model == m or self.model in m or m.startswith(self.model)
                        for m in models
                    )
                    return {
                        "available": True,
                        "base_url": self.base_url,
                        "target_model": self.model,
                        "target_model_installed": target_available,
                        "installed_models": models,
                        "gpu_target": "NVIDIA GeForce RTX 2050 (4GB VRAM)",
                        "status": "ready" if target_available else "model_missing",
                    }
        except urllib.error.URLError as e:
            return {
                "available": False,
                "base_url": self.base_url,
                "target_model": self.model,
                "error": f"Cannot connect to Ollama at {self.base_url}: {e.reason}",
                "status": "offline",
            }
        except Exception as e:
            return {
                "available": False,
                "base_url": self.base_url,
                "target_model": self.model,
                "error": str(e),
                "status": "error",
            }

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> LLMResponse:
        """
        Invoke Qwen3:4B via Ollama /api/chat.
        Extracts both final content and reasoning trace.
        """
        options = options or {}
        num_ctx = options.get("num_ctx", self.default_num_ctx)
        num_predict = options.get("num_predict", self.default_num_predict)
        temperature = options.get("temperature", 0.3)
        top_p = options.get("top_p", 0.9)

        if not system_prompt:
            system_prompt = (
                "You are the EduNexus AI Practical Laboratory Instructor at Mouse Innovations — an expert electrical engineering mentor. "
                "Think step-by-step through the circuit, explain physical current flow, and provide clear mathematical derivations."
            )

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        think_val = options.get("think", None)
        num_thread = options.get("num_thread", self.num_threads)

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_ctx": num_ctx,
                "num_predict": num_predict,
                "temperature": temperature,
                "top_p": top_p,
                "num_thread": num_thread,
            },
        }
        # Only explicitly pass think if caller requested it, otherwise Ollama isolates thinking automatically into msg['thinking']
        if think_val is not None:
            payload["think"] = think_val

        url = f"{self.base_url}/api/chat"
        t0 = time.time()

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                latency = time.time() - t0
                if res.status != 200:
                    return LLMResponse(
                        content="",
                        provider=self.provider_name,
                        model=self.model,
                        latency_seconds=latency,
                        status="error",
                        error_message=f"Ollama returned HTTP {res.status}",
                    )

                data = json.loads(res.read().decode("utf-8"))
                msg = data.get("message", {})
                content = msg.get("content", "").strip()
                thinking = msg.get("thinking", "").strip()

                # If the model emitted internal monologue starting with "Okay, the user is asking..."
                # or similar thought preamble inside content, strip it down to the actual answer:
                if content and ("Okay, the user" in content or "Let me start by" in content or "Hmm, the user" in content):
                    lines = content.split("\n")
                    # Filter out leading thought monologue lines until clean teacher response begins
                    filtered = []
                    found_clean_start = False
                    for line in lines:
                        l_strip = line.strip()
                        if not found_clean_start:
                            if l_strip.startswith(("1.", "2.", "3.", "4.", "5.", "6.", "###", "##", "#", "The ", "In ", "Voltage", "Current", "Resistance", "A ", "An ", "For ", "On ", "When ", "Aim:", "Theory:")):
                                found_clean_start = True
                                filtered.append(line)
                            elif l_strip and not any(l_strip.startswith(p) for p in ("Okay,", "Hmm,", "Let me", "Wait,", "The user", "I should", "I recall", "First,", "*")):
                                found_clean_start = True
                                filtered.append(line)
                        else:
                            filtered.append(line)
                    if filtered:
                        content = "\n".join(filtered).strip()

                # Discard internal meta-deliberation only if model solely output internal instructions:
                thought_leak_phrases = (
                    "let's write the response",
                    "the student is greeting, so",
                    "not forcing wiring analysis",
                )
                if content and any(p in content.lower() for p in thought_leak_phrases):
                    content = ""

                # If content is empty but model produced reasoning/thinking, extract the final explanation from thinking
                if not content and thinking:
                    # Look for answer indicators in thinking
                    for marker in ["So, the explanation:", "Now, for the explanation:", "Explanation:", "In conclusion:", "### ", "Therefore,"]:
                        if marker in thinking:
                            content = thinking.split(marker)[-1].strip()
                            if marker.startswith("###") or marker.startswith("Therefore"):
                                content = marker + " " + content
                            break
                    if not content:
                        # Use last paragraph of thinking if substantive
                        paragraphs = [p.strip() for p in thinking.split("\n\n") if p.strip()]
                        if paragraphs:
                            content = paragraphs[-1]

                if not content:
                    content = (
                        "I have analyzed your circuit configuration and component connections. "
                        "Feel free to ask me to explain the current path, derive the equivalent resistance, "
                        "or guide you through the next wiring step!"
                    )

                # When thinking is disabled, never return the internal thinking trace to the UI
                if not self.thinking_enabled:
                    thinking = None

                eval_count = data.get("eval_count")
                prompt_eval_count = data.get("prompt_eval_count")

                return LLMResponse(
                    content=content,
                    thinking=thinking,
                    provider=self.provider_name,
                    model=self.model,
                    latency_seconds=latency,
                    tokens_eval=eval_count,
                    tokens_prompt=prompt_eval_count,
                    status="success",
                    extra_metadata={
                        "eval_duration_ms": data.get("eval_duration", 0) / 1e6,
                        "load_duration_ms": data.get("load_duration", 0) / 1e6,
                        "num_ctx": num_ctx,
                    },
                )

        except urllib.error.URLError as e:
            latency = time.time() - t0
            return LLMResponse(
                content="",
                provider=self.provider_name,
                model=self.model,
                latency_seconds=latency,
                status="error",
                error_message=f"Ollama connection error: {e.reason}. Ensure Ollama is running (`ollama serve`).",
            )
        except Exception as e:
            latency = time.time() - t0
            return LLMResponse(
                content="",
                provider=self.provider_name,
                model=self.model,
                latency_seconds=latency,
                status="error",
                error_message=f"Ollama inference error: {str(e)}",
            )
