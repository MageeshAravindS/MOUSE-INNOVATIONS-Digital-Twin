"""
llm_client.py

Reliability-hardened multi-provider LLM client for EduNexus AI Teacher.
Supports Groq, Google Gemini, and OpenAI with auto-detection, dynamic .env reload,
and clear diagnostic error reporting.
"""

import os
import time
import logging
from typing import Optional

from dotenv import load_dotenv

logger = logging.getLogger("edunexus.llm_client")

# System prompt: describes the AI's professional role for every request.
SYSTEM_PROMPT = (
    "You are EduNexus AI Teacher -- a Senior Electrical Engineering "
    "Professor, Digital Twin Laboratory Instructor, Practical Exam "
    "Evaluator, and Circuit Troubleshooter, all in one.\n\n"
    "Your responsibilities:\n"
    "- Evaluate a student's live hardware wiring against the experiment's "
    "correct connection groups.\n"
    "- Explain circuit behavior clearly, the way an experienced lab "
    "faculty member would during a practical exam.\n"
    "- Identify wiring mistakes precisely, referencing group IDs, "
    "component names, and node numbers whenever they are provided.\n"
    "- Explain the practical effect of a missing or wrong connection on "
    "the circuit's output.\n"
    "- Give one clear, actionable correction for each issue.\n"
    "- Mention relevant safety precautions whenever a rewiring action is "
    "suggested.\n"
    "- Never invent components, node numbers, or readings that are not "
    "present in the information you are given. If something is not "
    "covered by the provided experiment knowledge, say so plainly "
    "instead of guessing.\n"
    "- Keep the tone encouraging, precise, and student-friendly, like a "
    "mentor guiding a student through a practical, not a generic "
    "chatbot."
)


class LLMGenerationError(RuntimeError):
    """Raised when the AI Teacher fails to produce a response.
    Carries a clear, user-facing message."""


def _get_active_provider_and_key():
    """Dynamically load environment variables so changes to .env take effect immediately."""
    # Find backend/.env or root .env
    env_paths = [
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.getcwd(), "backend", ".env"),
        os.path.join(os.getcwd(), ".env"),
    ]
    for p in env_paths:
        if os.path.isfile(p):
            load_dotenv(p, override=True)
            break
    else:
        load_dotenv(override=True)

    explicit_provider = os.getenv("LLM_PROVIDER", "").lower().strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    if explicit_provider == "gemini" and gemini_key:
        return "gemini", gemini_key
    if explicit_provider == "groq" and groq_key:
        return "groq", groq_key
    if explicit_provider == "openai" and openai_key:
        return "openai", openai_key

    # Auto-detection based on available keys
    if groq_key:
        return "groq", groq_key
    if gemini_key:
        return "gemini", gemini_key
    if openai_key:
        return "openai", openai_key

    return None, None


def _call_groq(api_key: str, prompt: str, timeout: float = 30.0) -> str:
    """Call Groq chat completion API using official groq SDK."""
    from groq import Groq, APIConnectionError, APIStatusError, APITimeoutError, RateLimitError, AuthenticationError

    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    client = Groq(api_key=api_key, timeout=timeout)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1024,
        )
        choice = response.choices[0] if response.choices else None
        content = choice.message.content.strip() if choice and choice.message and choice.message.content else ""
        if not content:
            raise LLMGenerationError("Groq returned an empty response. Please try rephrasing.")
        return content
    except AuthenticationError as exc:
        raise LLMGenerationError(
            "Invalid GROQ_API_KEY: The API key in backend/.env was rejected by Groq (HTTP 401). "
            "Please verify your key at https://console.groq.com/keys"
        ) from exc
    except RateLimitError as exc:
        raise LLMGenerationError(
            "Groq rate limit reached. Please wait a moment before asking again."
        ) from exc
    except (APITimeoutError, APIConnectionError) as exc:
        raise LLMGenerationError(
            f"Groq connection timed out: {exc}. Please check your internet connection."
        ) from exc
    except APIStatusError as exc:
        raise LLMGenerationError(
            f"Groq API error ({exc.status_code}): {exc.message}"
        ) from exc


def _call_gemini(api_key: str, prompt: str, timeout: float = 30.0) -> str:
    """Call Google Gemini REST API using requests."""
    import requests

    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = {
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPT}]
        },
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1024,
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        if resp.status_code == 400 or resp.status_code == 403:
            err_data = resp.json().get("error", {})
            err_msg = err_data.get("message", resp.text)
            raise LLMGenerationError(
                f"Invalid GEMINI_API_KEY: Google Gemini rejected the request ({resp.status_code}): {err_msg}. "
                "Get a valid key at https://aistudio.google.com/app/apikey"
            )
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise LLMGenerationError("Gemini returned no candidates. Please rephrase your query.")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            raise LLMGenerationError("Gemini returned an empty response.")
        return text
    except requests.exceptions.Timeout as exc:
        raise LLMGenerationError("Gemini request timed out. Please try again.") from exc
    except requests.exceptions.RequestException as exc:
        if isinstance(exc, requests.exceptions.HTTPError):
            raise LLMGenerationError(f"Gemini API error ({resp.status_code}): {resp.text}") from exc
        raise LLMGenerationError(f"Gemini connection error: {exc}") from exc


def _call_openai(api_key: str, prompt: str, timeout: float = 30.0) -> str:
    """Call OpenAI REST API."""
    import requests

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    url = "https://api.openai.com/v1/chat/completions"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 1024,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
        if resp.status_code == 401:
            raise LLMGenerationError(
                "Invalid OPENAI_API_KEY: Rejected by OpenAI (HTTP 401). "
                "Verify your key at https://platform.openai.com/api-keys"
            )
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise LLMGenerationError("OpenAI returned no choices.")
        return choices[0].get("message", {}).get("content", "").strip()
    except requests.exceptions.RequestException as exc:
        raise LLMGenerationError(f"OpenAI error: {exc}") from exc


def generate_answer(
    prompt: str,
    provider_name: Optional[str] = None,
    system_prompt: Optional[str] = None,
    options: Optional[dict] = None,
) -> str:
    """
    Generate an AI response using the requested or configured provider (Ollama Qwen3 or Cloud API).
    """
    res = generate_answer_full(
        prompt=prompt,
        provider_name=provider_name,
        system_prompt=system_prompt,
        options=options,
    )
    if res.status != "success":
        raise LLMGenerationError(res.error_message or "Unknown LLM generation error")
    return res.content


def generate_answer_full(
    prompt: str,
    provider_name: Optional[str] = None,
    system_prompt: Optional[str] = None,
    options: Optional[dict] = None,
):
    """
    Generate an AI response and return the full LLMResponse object
    (including latency, token counts, thinking, and provider metadata).
    """
    from .providers import get_provider
    provider = get_provider(provider_name)
    sys_prompt = system_prompt if system_prompt is not None else SYSTEM_PROMPT
    return provider.generate(prompt=prompt, system_prompt=sys_prompt, options=options)

