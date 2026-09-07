"""
experiment_loader.py

Single responsibility: load an experiment's knowledge JSON from
backend/ai/knowledge/ and return it as a plain dict.

No analysis logic. No prompt formatting. No FastAPI.
"""

import json
from pathlib import Path
from typing import Any, Dict

BASE_DIR = Path(__file__).resolve().parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"


class ExperimentNotFoundError(FileNotFoundError):
    """Raised when the requested experiment JSON does not exist."""


class ExperimentLoadError(ValueError):
    """Raised when the experiment JSON exists but cannot be parsed."""


def load_experiment(experiment_name: str) -> Dict[str, Any]:
    """
    Load an experiment's knowledge file.

    Args:
        experiment_name: name of the experiment, matching a file
            <experiment_name>.json inside knowledge/ (e.g. "bridge_rectifier").

    Returns:
        Parsed JSON as a dict.

    Raises:
        ExperimentNotFoundError: if no matching JSON file exists.
        ExperimentLoadError: if the file exists but contains invalid JSON.
    """
    file_path = KNOWLEDGE_DIR / f"{experiment_name}.json"

    if not file_path.exists():
        raise ExperimentNotFoundError(
            f"No knowledge file found for experiment '{experiment_name}' "
            f"(expected {file_path})"
        )

    try:
        with file_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        raise ExperimentLoadError(
            f"Experiment file '{file_path.name}' contains invalid JSON: {exc}"
        ) from exc


def experiment_exists(experiment_name: str) -> bool:
    """Check whether a knowledge file exists for the given experiment."""
    return (KNOWLEDGE_DIR / f"{experiment_name}.json").exists()


def list_available_experiments() -> list[str]:
    """Return the names of all experiments with knowledge files available."""
    if not KNOWLEDGE_DIR.exists():
        return []
    return sorted(p.stem for p in KNOWLEDGE_DIR.glob("*.json"))
