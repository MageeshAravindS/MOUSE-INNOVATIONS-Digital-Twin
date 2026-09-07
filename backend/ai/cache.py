"""
backend/ai/cache.py

Thread-safe in-memory cache for static educational responses (Ohm's Law, theory).
Per Section 25: NEVER caches responses that depend on circuit state, measurements,
or student-specific attempts.
"""

import hashlib
import time
from typing import Optional


class ResponseCache:
    """In-memory LRU-style cache with TTL for static theory queries."""

    def __init__(self, max_size: int = 100, ttl_seconds: float = 3600.0):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache = {}

    def _make_key(self, experiment_name: str, question: str, provider: str) -> str:
        raw = f"{experiment_name.lower().strip()}:{question.lower().strip()}:{provider.lower().strip()}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, experiment_name: str, question: str, provider: str) -> Optional[str]:
        key = self._make_key(experiment_name, question, provider)
        entry = self._cache.get(key)
        if not entry:
            return None
        cached_time, response = entry
        if time.time() - cached_time > self.ttl_seconds:
            del self._cache[key]
            return None
        return response

    def set(self, experiment_name: str, question: str, provider: str, response: str) -> None:
        if len(self._cache) >= self.max_size:
            # Pop oldest item
            oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        key = self._make_key(experiment_name, question, provider)
        self._cache[key] = (time.time(), response)

    def clear(self) -> None:
        self._cache.clear()


# Global cache instance
global_response_cache = ResponseCache()
