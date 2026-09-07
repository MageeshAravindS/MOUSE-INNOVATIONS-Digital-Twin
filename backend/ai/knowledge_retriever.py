"""
backend/ai/knowledge_retriever.py

Lightweight context-aware knowledge retriever.
Per Section 6 and Section 18:
Retrieves only the relevant slice of an experiment's knowledge base
(Theory, Waveforms, Troubleshooting, Safety, or Viva) to keep prompt
size minimal and avoid VRAM exhaustion on RTX 2050.
"""

from typing import Any, Dict, Optional


def retrieve_relevant_knowledge(
    experiment: Dict[str, Any],
    query: str,
    mode: str = "experiment",
) -> Dict[str, Any]:
    """
    Filter experiment knowledge down to only what is needed for the question.
    """
    q = query.lower()
    retrieved = {
        "experiment_name": experiment.get("experiment_name", ""),
        "category": experiment.get("category", ""),
    }

    # If viva mode, retrieve viva questions
    if mode == "viva" or "viva" in q or "test me" in q:
        retrieved["viva_questions"] = experiment.get("viva_questions", [])[:4]
        return retrieved

    # Waveform inquiry
    if "waveform" in q or "cro" in q or "oscilloscope" in q:
        retrieved["expected_waveforms"] = experiment.get("waveform") or experiment.get("expected_waveforms", [])
        return retrieved

    # Safety inquiry
    if "safety" in q or "hazard" in q or "shock" in q or "precaution" in q:
        retrieved["safety"] = experiment.get("safety") or experiment.get("precautions", [])
        return retrieved

    # Troubleshooting inquiry
    if "troubleshoot" in q or "error" in q or "not working" in q or "issue" in q:
        retrieved["troubleshooting"] = experiment.get("troubleshooting", [])
        return retrieved

    # Theory / Aim inquiry
    if mode == "theory" or "what is" in q or "explain" in q or "how does" in q or "theory" in q:
        theory = experiment.get("theory", {})
        if isinstance(theory, dict):
            retrieved["overview"] = theory.get("overview", "")
            retrieved["working_principle"] = theory.get("working_principle", "")
            retrieved["applications"] = theory.get("applications", [])[:3]
        elif isinstance(theory, str):
            retrieved["overview"] = theory
        retrieved["aim"] = experiment.get("objective") or experiment.get("aim", "")
        return retrieved

    # Default: Objective + brief theory overview
    retrieved["aim"] = experiment.get("objective") or experiment.get("aim", "")
    theory = experiment.get("theory", {})
    if isinstance(theory, dict):
        retrieved["overview"] = theory.get("overview", "")
    elif isinstance(theory, str):
        retrieved["overview"] = theory[:300]

    return retrieved
