from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional, Sequence

log = logging.getLogger("structured_openai")

STRUCTURED_LLM_ENABLED = (
    os.getenv("STRUCTURED_LLM_ENABLED", "false").lower() == "true"
)
STRUCTURED_LLM_MODEL = os.getenv("STRUCTURED_LLM_MODEL") or os.getenv("LLM_MODEL") or "gpt-4o-mini"
STRUCTURED_LLM_TIMEOUT_S = float(os.getenv("STRUCTURED_LLM_TIMEOUT_S", "45"))
STRUCTURED_LLM_MAX_CHARS = int(os.getenv("STRUCTURED_LLM_MAX_CHARS", "14000"))
STRUCTURED_LLM_MAX_UNITS = int(os.getenv("STRUCTURED_LLM_MAX_UNITS", "12"))

_DOC_TYPES = [
    "direction",
    "order",
    "office_memorandum",
    "notice",
    "minutes",
    "sop_guideline",
]

_SECTORS = [
    "transport",
    "construction_demolition",
    "waste_burning",
    "biomass_burning",
    "industry_power",
    "dg_sets",
]

_AGENCIES = [
    "caqm",
    "cpcb",
    "dpcc",
    "spcb",
    "imd",
    "iit",
]

_GEOGRAPHY = [
    "delhi",
    "ncr",
    "haryana",
    "uttar_pradesh",
    "rajasthan",
]

_PROGRAMS = [
    "grap",
]

_POLLUTANTS = [
    "pm25",
    "pm10",
    "no2",
    "o3",
    "co",
]


def has_structured_llm() -> bool:
    key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    return STRUCTURED_LLM_ENABLED and bool(key)


def get_structured_model() -> str:
    return STRUCTURED_LLM_MODEL


def _client():
    from openai import OpenAI

    base = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENROUTER_BASE_URL")
    key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("No OPENAI_API_KEY/OPENROUTER_API_KEY provided")

    return OpenAI(api_key=key, base_url=base) if base else OpenAI(api_key=key)


def _enum_or_null(values: Sequence[str]) -> Dict[str, Any]:
    return {
        "anyOf": [
            {"type": "string", "enum": list(values)},
            {"type": "null"},
        ]
    }


def _label_item_schema(values: Sequence[str]) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "value": _enum_or_null(values),
            "score": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
            "evidence": {"type": "string"},
        },
        "required": ["value", "score", "evidence"],
    }


_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "profile": {"type": "string", "enum": ["caqm"]},
        "version": {"type": "integer", "enum": [1]},
        "docType": _label_item_schema(_DOC_TYPES),
        "labels": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "sectors": {
                    "type": "array",
                    "items": _label_item_schema(_SECTORS),
                },
                "agencies": {
                    "type": "array",
                    "items": _label_item_schema(_AGENCIES),
                },
                "geography": {
                    "type": "array",
                    "items": _label_item_schema(_GEOGRAPHY),
                },
                "programs": {
                    "type": "array",
                    "items": _label_item_schema(_PROGRAMS),
                },
                "pollutants": {
                    "type": "array",
                    "items": _label_item_schema(_POLLUTANTS),
                },
            },
            "required": [
                "sectors",
                "agencies",
                "geography",
                "programs",
                "pollutants",
            ],
        },
        "grap": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "mentioned": {"type": "boolean"},
                "stage": {
                    "anyOf": [
                        {"type": "string", "enum": ["I", "II", "III", "IV"]},
                        {"type": "null"},
                    ]
                },
                "evidence": {"type": "string"},
            },
            "required": ["mentioned", "stage", "evidence"],
        },
        "entities": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "directionNumbers": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "orderNumbers": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "referenceNumbers": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "dates": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": [
                "directionNumbers",
                "orderNumbers",
                "referenceNumbers",
                "dates",
            ],
        },
    },
    "required": ["profile", "version", "docType", "labels", "grap", "entities"],
}


def _clip(text: str, n: int) -> str:
    text = (text or "").strip()
    if len(text) <= n:
        return text
    return text[:n].rstrip() + " …"


def _short_locator(locator: Optional[Dict[str, Any]]) -> str:
    loc = locator or {}
    kind = str(loc.get("kind") or "").lower()

    if kind == "page" and loc.get("pageNumber"):
        return f"[page {loc.get('pageNumber')}]"
    if kind == "image-frame" and loc.get("frameNumber"):
        return f"[image frame {loc.get('frameNumber')}]"
    if kind == "image":
        return "[image]"
    return "[document]"


def _unit_preview(units: Sequence[Dict[str, Any]]) -> str:
    out: List[str] = []
    for u in list(units)[:STRUCTURED_LLM_MAX_UNITS]:
        txt = str(u.get("text") or "").replace("\n", " ").strip()
        if not txt:
            continue
        out.append(f"{_short_locator(u.get('locator') or {})} {_clip(txt, 320)}")
    return "\n".join(f"- {x}" for x in out)


_SYSTEM_PROMPT = """You classify CAQM / NCR air-quality policy documents into a strict existing schema.

Rules:
- Return ONLY JSON matching the schema.
- Use ONLY the canonical vocabulary allowed by the schema.
- Keep the existing label structure exactly.
- Use evidence from the provided document text only.
- OCR text may be noisy; use fuzzy interpretation, but do not invent facts.
- If a field is unknown, return null (for single values) or [] (for arrays).
- Evidence should be a short, specific snippet from the document text.
- Prefer precise labels that are actually supported by evidence in the text.
"""


def extract_structured_with_llm(
    *,
    content: str,
    file_name: Optional[str],
    tags: Optional[Sequence[str]],
    extraction: Optional[Dict[str, Any]],
    grounding_units: Optional[Sequence[Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    if not has_structured_llm():
        return None

    body = (content or "").strip()
    if not body:
        return None

    client = _client()
    model = get_structured_model()

    excerpt = _clip(body, STRUCTURED_LLM_MAX_CHARS)
    unit_preview = _unit_preview(grounding_units or [])
    tag_text = ", ".join([str(t).strip() for t in (tags or []) if str(t).strip()][:20])

    extraction_meta = extraction or {}
    extraction_summary = {
        "kind": extraction_meta.get("kind"),
        "mode": extraction_meta.get("mode"),
        "ocrUsed": extraction_meta.get("ocrUsed"),
        "unitCount": extraction_meta.get("unitCount"),
        "charCount": extraction_meta.get("charCount"),
    }

    user_prompt = f"""File name:
{file_name or "unknown"}

Existing tags:
{tag_text or "none"}

Extraction summary:
{json.dumps(extraction_summary, ensure_ascii=False)}

Grounding previews:
{unit_preview or "(none)"}

Document text:
{excerpt}
"""

    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=1400,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "caqm_structured",
                    "schema": _SCHEMA,
                    "strict": True,
                },
            },
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            timeout=STRUCTURED_LLM_TIMEOUT_S,
        )

        raw = (resp.choices[0].message.content or "").strip()
        if not raw:
            return None

        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None

        parsed["profile"] = "caqm"
        parsed["version"] = 1
        return parsed
    except Exception as e:
        log.warning("structured llm extraction failed: %s", e)
        return None


def _empty_label_item() -> Dict[str, Any]:
    return {"value": None, "score": 0.0, "evidence": ""}


def _empty_structured() -> Dict[str, Any]:
    return {
        "profile": "caqm",
        "version": 1,
        "docType": _empty_label_item(),
        "labels": {
            "sectors": [],
            "agencies": [],
            "geography": [],
            "programs": [],
            "pollutants": [],
        },
        "grap": {
            "mentioned": False,
            "stage": None,
            "evidence": "",
        },
        "entities": {
            "directionNumbers": [],
            "orderNumbers": [],
            "referenceNumbers": [],
            "dates": [],
        },
    }


def _clean_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None

    raw_value: Any = item.get("value")
    value: Optional[str]
    if raw_value is None:
        value = None
    else:
        value = str(raw_value).strip() or None

    raw_score: Any = item.get("score", 0.0)
    score: float
    if raw_score is None:
        score = 0.0
    else:
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0

    evidence = str(item.get("evidence", "") or "").strip()

    if value is None and not evidence:
        return None

    return {
        "value": value,
        "score": max(0.0, min(1.0, score)),
        "evidence": evidence,
    }

def _merge_items(
    preferred: Any,
    fallback: Any,
    *,
    limit: int,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()

    for source in (preferred or [], fallback or []):
        if not isinstance(source, list):
            continue
        for raw in source:
            item = _clean_item(raw)
            if not item:
                continue
            key = str(item.get("value") or "").strip().casefold()
            if not key:
                continue
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
            if len(out) >= limit:
                return out

    return out


def _pick_single(preferred: Any, fallback: Any) -> Dict[str, Any]:
    a = _clean_item(preferred)
    if a and a.get("value"):
        return a
    b = _clean_item(fallback)
    if b:
        return b
    return _empty_label_item()


def _uniq_strings(*groups: Any) -> List[str]:
    out: List[str] = []
    seen = set()

    for group in groups:
        if not isinstance(group, list):
            continue
        for raw in group:
            s = str(raw or "").strip()
            if not s:
                continue
            k = s.casefold()
            if k in seen:
                continue
            seen.add(k)
            out.append(s)

    return out


def _as_obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def merge_structured(
    preferred: Optional[Dict[str, Any]],
    fallback: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    p: Dict[str, Any] = _as_obj(preferred)
    f: Dict[str, Any] = _as_obj(fallback)
    out: Dict[str, Any] = _empty_structured()

    out["docType"] = _pick_single(p.get("docType"), f.get("docType"))

    p_labels: Dict[str, Any] = _as_obj(p.get("labels"))
    f_labels: Dict[str, Any] = _as_obj(f.get("labels"))

    out["labels"] = {
        "sectors": _merge_items(
            p_labels.get("sectors"),
            f_labels.get("sectors"),
            limit=6,
        ),
        "agencies": _merge_items(
            p_labels.get("agencies"),
            f_labels.get("agencies"),
            limit=8,
        ),
        "geography": _merge_items(
            p_labels.get("geography"),
            f_labels.get("geography"),
            limit=6,
        ),
        "programs": _merge_items(
            p_labels.get("programs"),
            f_labels.get("programs"),
            limit=4,
        ),
        "pollutants": _merge_items(
            p_labels.get("pollutants"),
            f_labels.get("pollutants"),
            limit=6,
        ),
    }

    p_grap: Dict[str, Any] = _as_obj(p.get("grap"))
    f_grap: Dict[str, Any] = _as_obj(f.get("grap"))

    out["grap"] = {
        "mentioned": bool(p_grap.get("mentioned") or f_grap.get("mentioned")),
        "stage": p_grap.get("stage") or f_grap.get("stage") or None,
        "evidence": str(p_grap.get("evidence") or f_grap.get("evidence") or ""),
    }

    p_entities: Dict[str, Any] = _as_obj(p.get("entities"))
    f_entities: Dict[str, Any] = _as_obj(f.get("entities"))

    out["entities"] = {
        "directionNumbers": _uniq_strings(
            p_entities.get("directionNumbers"),
            f_entities.get("directionNumbers"),
        ),
        "orderNumbers": _uniq_strings(
            p_entities.get("orderNumbers"),
            f_entities.get("orderNumbers"),
        ),
        "referenceNumbers": _uniq_strings(
            p_entities.get("referenceNumbers"),
            f_entities.get("referenceNumbers"),
        ),
        "dates": _uniq_strings(
            p_entities.get("dates"),
            f_entities.get("dates"),
        ),
    }

    return out