from __future__ import annotations

from typing import Any, Dict, Optional


def _normalized_model(model: Optional[str]) -> str:
    return (model or "").strip().lower()


def model_requires_default_temperature(model: Optional[str]) -> bool:
    name = _normalized_model(model)
    return name.startswith(("gpt-5", "o1", "o3", "o4"))


def chat_completion_kwargs(
    *,
    model: Optional[str],
    max_completion_tokens: int,
    temperature: Optional[float] = None,
) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {"max_completion_tokens": max_completion_tokens}

    if temperature is not None and not model_requires_default_temperature(model):
        kwargs["temperature"] = temperature

    return kwargs
