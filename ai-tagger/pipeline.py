# ai-tagger/pipeline.py
"""
Synchronous extraction + lightweight tagging pipeline.

Exports:
- extract_and_tag_sync(...) -> dict
This file is intentionally self-contained (no heavy optional deps),
so it runs both in Celery workers and under Pylance without unresolved symbols.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

# We'll lazy-import the extractor to avoid import/path issues in Celery forks.
extract_text = None
extract_content = None

# Taxonomy is optional; try both absolute and relative, else noop.
try:
    from taxonomy import apply_taxonomy  # type: ignore
except Exception:  # pragma: no cover
    try:
        from .taxonomy import apply_taxonomy  # type: ignore
    except Exception:  # pragma: no cover

        def apply_taxonomy(tags: Sequence[str]) -> List[str]:
            return list(dict.fromkeys(tags))


log = logging.getLogger("pipeline")
TAGGER_VERSION = os.getenv("TAGGER_VERSION", "0.5.0")

# Optional advanced candidate generator (KeyBERT/YAKE/spaCy).
try:
    from candidates import generate_candidates  # type: ignore
except Exception:  # pragma: no cover
    try:
        from .candidates import generate_candidates  # type: ignore
    except Exception:  # pragma: no cover
        generate_candidates = None  # type: ignore

# Optional structured OpenAI extraction.
try:
    from structured_openai import (  # type: ignore
        extract_governance_with_llm,
        extract_structured_with_llm,
        get_structured_model,
        has_structured_llm,
        merge_structured,
    )
except Exception:  # pragma: no cover
    try:
        from .structured_openai import (  # type: ignore
            extract_governance_with_llm,
            extract_structured_with_llm,
            get_structured_model,
            has_structured_llm,
            merge_structured,
        )
    except Exception:  # pragma: no cover

        def has_structured_llm() -> bool:
            return False

        def get_structured_model() -> str:
            return ""

        def extract_governance_with_llm(
            *,
            content: str,
            file_name: Optional[str],
            tags: Optional[Sequence[str]],
            extraction: Optional[Dict[str, Any]],
            grounding_units: Optional[Sequence[Dict[str, Any]]],
        ) -> Optional[Dict[str, Any]]:
            return None

        def merge_structured(
            preferred: Optional[Dict[str, Any]],
            fallback: Optional[Dict[str, Any]],
        ) -> Dict[str, Any]:
            return fallback if isinstance(fallback, dict) else {}


# simple tokenizer (letters/digits/hyphen/+/underscore); no trailing dots
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-+/_]*")
_STOPWORDS = set(
    """
a about above across after again against all almost alone along already also although always am among an
and another any anybody anyone anything anywhere are around as at back be became because become becomes
been before being below between both but by can cannot could couldn did didn do does doesn doing done
down during each either else ever every few for from further get got had hadn has hasn have haven having
he her here hers herself him himself his how however i if in into is isn it its itself just least less
let like likely ll m ma made make makes many may me might more most mostly much must my myself near no nor
not of off often on once one only onto or other our ours ourselves out over own per perhaps rather re same
seem seemed seeming seems several she should shouldn since so some somebody someone sometime
sometimes somewhere still such t than that the their theirs them themselves then there therefore these
they this those though through to too under until up us very via was wasn we well were weren what when
where whether which while who whom whose why will with within without won would wouldn you your yours yourself yourselves
""".split()
)

# High-signal tokens/phrases that often appear only once but should still surface as tags:
_ACRONYM_RE = re.compile(r"\b[A-Z]{2,10}\b")
_ACRONYM_WITH_WORD_RE = re.compile(r"\b([A-Z]{2,10})\s+([A-Z][a-z]{2,})\b")
_ALPHANUM_RE = re.compile(r"\b[A-Z]{1,6}\d+(?:\.\d+)?\b")
_TITLE_SEQ_RE = re.compile(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")


def _extract_signal_terms(text: str, limit: int = 60000) -> List[str]:
    if not text:
        return []

    t = text[:limit]
    out: List[str] = []
    seen = set()

    def add(s: str) -> None:
        s = (s or "").strip()
        if not s:
            return
        k = s.casefold()
        if k in seen:
            return
        if len(s) < 3:
            return
        if " " not in s and k in _STOPWORDS:
            return
        seen.add(k)
        out.append(s)

    for m in _ACRONYM_WITH_WORD_RE.finditer(t):
        add(f"{m.group(1)} {m.group(2)}")

    for m in _TITLE_SEQ_RE.finditer(t):
        add(m.group(0))

    for m in _ALPHANUM_RE.finditer(t):
        add(m.group(0))

    for m in _ACRONYM_RE.finditer(t):
        add(m.group(0))

    return out[:80]


def _tokenize(text: str) -> List[str]:
    return [m.group(0).lower() for m in _WORD_RE.finditer(text)]


def _extract_unigrams(tokens: Sequence[str], topk: int = 200) -> List[str]:
    counts = Counter(t for t in tokens if t not in _STOPWORDS and len(t) > 2)
    for k in list(counts.keys()):
        if k.isnumeric() or re.fullmatch(r"[a-z]\d+[a-z]?", k):
            counts[k] = int(counts[k] * 0.3)
    return [w for w, _ in counts.most_common(topk)]


def _extract_phrases(tokens: Sequence[str], topk: int = 200) -> List[str]:
    bigrams = Counter(" ".join(p) for p in zip(tokens, tokens[1:]))
    filtered = Counter()
    for phrase, c in bigrams.items():
        a, b = phrase.split(" ")
        if a in _STOPWORDS and b in _STOPWORDS:
            continue
        if a in _STOPWORDS or b in _STOPWORDS:
            c = int(c * 0.5)
        filtered[phrase] = c
    return [p for p, _ in filtered.most_common(topk)]


def _load_content_bundle(
    *,
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    global extract_text, extract_content
    try:
        if extract_text is None or extract_content is None:
            import importlib
            import pathlib
            import sys

            _THIS_DIR = pathlib.Path(__file__).parent.resolve()
            if str(_THIS_DIR) not in sys.path:
                sys.path.insert(0, str(_THIS_DIR))

            extractors = importlib.import_module("extractors")
            extract_text = getattr(extractors, "extract_text")
            extract_content = getattr(extractors, "extract_content")

        bundle = (
            extract_content(
                text=text,
                url=url,
                file_bytes=file_bytes,
                file_name=file_name,
                file_path=file_path,
                ocr_options=ocr_options,
            )
            or {}
        )

        if isinstance(bundle, dict) and "text" in bundle:
            return bundle

        content = (
            extract_text(
                text=text,
                url=url,
                file_bytes=file_bytes,
                file_name=file_name,
                file_path=file_path,
                ocr_options=ocr_options,
            )
            or ""
        )

        return {
            "text": content,
            "extraction": {
                "kind": "unknown",
                "mode": "legacy",
                "ocrUsed": False,
                "unitCount": 0,
                "charCount": len(content),
                "units": [],
            },
            "groundingUnits": [],
        }
    except Exception as e:
        log.warning("extract_text failed: %s", e)
        content = text or ""
        return {
            "text": content,
            "extraction": {
                "kind": "unknown",
                "mode": "error",
                "ocrUsed": False,
                "unitCount": 0,
                "charCount": len(content),
                "units": [],
            },
            "groundingUnits": [],
        }


def _classify_structured_safe(
    content: str,
    file_name: Optional[str],
    tags: List[str],
):
    try:
        try:
            from policy_taxonomy import classify_structured  # type: ignore
        except Exception:
            from .policy_taxonomy import classify_structured  # type: ignore

        return classify_structured(content, file_name=file_name, tags=tags)
    except Exception:
        return None


def _normalize_ws(s: str) -> str:
    return " ".join((s or "").replace("\u2026", " ").split()).strip().lower()


def _locator_prefix(locator: Optional[Dict[str, Any]]) -> str:
    loc = locator or {}
    kind = str(loc.get("kind") or "").lower()

    if kind == "page" and loc.get("pageNumber"):
        return f"[page {loc.get('pageNumber')}] "
    if kind == "image-frame":
        if loc.get("frameNumber"):
            return f"[image frame {loc.get('frameNumber')}] "
        return "[image frame] "
    if kind == "image":
        return "[image] "

    return "[document] "


def _find_unit_for_evidence(
    evidence: str,
    units: Sequence[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    needle = _normalize_ws(evidence)
    if not needle:
        return None

    candidates = [needle]
    words = [w for w in needle.split() if len(w) >= 4]

    if len(words) >= 6:
        candidates.append(" ".join(words[:6]))
    if len(words) >= 10:
        candidates.append(" ".join(words[:10]))

    for u in units:
        hay = _normalize_ws(str(u.get("text") or ""))
        if not hay:
            continue

        if any(c and c in hay for c in candidates):
            return u

        if words and sum(1 for w in words[:8] if w in hay) >= min(4, len(words[:8])):
            return u

    return None


def _ground_label_item(item: Any, units: Sequence[Dict[str, Any]]) -> Any:
    if not isinstance(item, dict):
        return item

    evidence = str(item.get("evidence") or "").strip()
    if not evidence:
        return item

    unit = _find_unit_for_evidence(evidence, units)
    if not unit:
        return item

    locator = unit.get("locator") or {}
    prefix = _locator_prefix(locator)

    if not evidence.startswith("["):
        item["evidence"] = prefix + evidence

    item["locator"] = locator
    return item


def _ground_structured(structured: Any, units: Sequence[Dict[str, Any]]) -> Any:
    if not structured or not isinstance(structured, dict) or not units:
        return structured

    doc_type = structured.get("docType")
    if isinstance(doc_type, dict):
        structured["docType"] = _ground_label_item(doc_type, units)

    labels = structured.get("labels")
    if isinstance(labels, dict):
        for key, arr in labels.items():
            if isinstance(arr, list):
                labels[key] = [_ground_label_item(it, units) for it in arr]

    grap = structured.get("grap")
    if isinstance(grap, dict):
        structured["grap"] = _ground_label_item(grap, units)

    return structured


def _ground_evidence_dict(item: Any, units: Sequence[Dict[str, Any]]) -> Any:
    if not isinstance(item, dict):
        return item

    evidence = str(item.get("evidence") or "").strip()
    if not evidence:
        return item

    unit = _find_unit_for_evidence(evidence, units)
    if not unit:
        return item

    locator = unit.get("locator") or {}
    prefix = _locator_prefix(locator)

    if not evidence.startswith("["):
        item["evidence"] = prefix + evidence

    item["locator"] = locator
    return item


def _empty_governance() -> Dict[str, Any]:
    return {
        "profile": "governance",
        "version": 1,
        "agencies": [],
        "issues": [],
        "mandates": [],
        "claims": [],
        "events": [],
        "positions": [],
        "gaps": [],
        "relations": [],
    }


def _clean_text(value: Any, limit: int = 500) -> Optional[str]:
    s = " ".join(str(value or "").replace("\u2026", " ").split()).strip()
    if not s:
        return None
    return s[:limit]


def _clean_confidence(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, n))


def _pick_enum(
    value: Any, allowed: Sequence[str], *, default: Optional[str] = None
) -> Optional[str]:
    raw = _clean_text(value, 80)
    if not raw:
        return default
    norm = raw.strip().lower().replace(" ", "_").replace("-", "_")
    return norm if norm in allowed else default


def _normalize_governance_item(
    raw: Any, *, spec: Dict[str, Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    out: Dict[str, Any] = {}
    for field, cfg in spec.items():
        kind = cfg.get("kind")
        if kind == "text":
            out[field] = _clean_text(raw.get(field), cfg.get("limit", 500))
        elif kind == "enum":
            out[field] = _pick_enum(
                raw.get(field), cfg.get("allowed") or [], default=cfg.get("default")
            )
        elif kind == "confidence":
            out[field] = _clean_confidence(raw.get(field))
        else:
            out[field] = raw.get(field)

    evidence = _clean_text(raw.get("evidence"), 500) or ""
    out["evidence"] = evidence
    return out


def _dedupe_governance_items(
    items: Sequence[Dict[str, Any]], *, key_fields: Sequence[str], limit: int
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in items:
        key = tuple((item.get(field) or "") for field in key_fields)
        if not any(key):
            continue
        norm_key = tuple(str(v).strip().casefold() for v in key)
        if norm_key in seen:
            continue
        seen.add(norm_key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _normalize_governance(governance: Any) -> Dict[str, Any]:
    if not isinstance(governance, dict):
        return _empty_governance()

    agency_allowed = [
        "regulator",
        "judiciary",
        "ministry",
        "executive",
        "local_body",
        "research_body",
        "civil_society",
        "private_sector",
        "other",
    ]
    issue_kind_allowed = ["governance_issue", "case_file"]
    mandate_type_allowed = [
        "statutory",
        "regulatory",
        "advisory",
        "enforcement",
        "operational",
        "coordination",
        "reporting",
        "monitoring",
        "other",
    ]
    polarity_allowed = ["support", "oppose", "neutral", "mixed", "unknown"]
    gap_allowed = [
        "overlap",
        "ambiguity",
        "accountability",
        "coordination",
        "enforcement",
        "data",
        "evidence",
        "coverage",
        "other",
    ]
    relation_allowed = [
        "contradiction",
        "tension",
        "override",
        "reinforcement",
        "alignment",
        "duplication",
        "reference",
        "supersedes",
        "other",
    ]

    agencies = [
        _normalize_governance_item(
            raw,
            spec={
                "name": {"kind": "text", "limit": 160},
                "shortName": {"kind": "text", "limit": 80},
                "category": {
                    "kind": "enum",
                    "allowed": agency_allowed,
                    "default": "other",
                },
                "jurisdiction": {"kind": "text", "limit": 120},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("agencies") or [])
    ]
    agencies = [item for item in agencies if item and item.get("name")]
    agencies = _dedupe_governance_items(
        agencies, key_fields=["name", "jurisdiction"], limit=24
    )

    issues = [
        _normalize_governance_item(
            raw,
            spec={
                "title": {"kind": "text", "limit": 220},
                "kind": {
                    "kind": "enum",
                    "allowed": issue_kind_allowed,
                    "default": "governance_issue",
                },
                "summary": {"kind": "text", "limit": 280},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("issues") or [])
    ]
    issues = [item for item in issues if item and item.get("title")]
    issues = _dedupe_governance_items(issues, key_fields=["title"], limit=24)

    mandates = [
        _normalize_governance_item(
            raw,
            spec={
                "agencyName": {"kind": "text", "limit": 160},
                "issueTitle": {"kind": "text", "limit": 220},
                "title": {"kind": "text", "limit": 220},
                "description": {"kind": "text", "limit": 320},
                "mandateType": {
                    "kind": "enum",
                    "allowed": mandate_type_allowed,
                    "default": "other",
                },
                "effectiveDateText": {"kind": "text", "limit": 80},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("mandates") or [])
    ]
    mandates = [item for item in mandates if item and item.get("title")]
    mandates = _dedupe_governance_items(
        mandates, key_fields=["agencyName", "title"], limit=40
    )

    claims = [
        _normalize_governance_item(
            raw,
            spec={
                "issueTitle": {"kind": "text", "limit": 220},
                "subjectAgencyName": {"kind": "text", "limit": 160},
                "claimText": {"kind": "text", "limit": 500},
                "claimSummary": {"kind": "text", "limit": 280},
                "polarity": {
                    "kind": "enum",
                    "allowed": polarity_allowed,
                    "default": "unknown",
                },
                "scopeText": {"kind": "text", "limit": 220},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("claims") or [])
    ]
    claims = [item for item in claims if item and item.get("claimText")]
    claims = _dedupe_governance_items(
        claims, key_fields=["subjectAgencyName", "claimText"], limit=60
    )

    events = [
        _normalize_governance_item(
            raw,
            spec={
                "issueTitle": {"kind": "text", "limit": 220},
                "actorAgencyName": {"kind": "text", "limit": 160},
                "title": {"kind": "text", "limit": 220},
                "summary": {"kind": "text", "limit": 280},
                "eventDateText": {"kind": "text", "limit": 80},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("events") or [])
    ]
    events = [item for item in events if item and item.get("title")]
    events = _dedupe_governance_items(
        events, key_fields=["actorAgencyName", "title", "eventDateText"], limit=60
    )

    positions = [
        _normalize_governance_item(
            raw,
            spec={
                "issueTitle": {"kind": "text", "limit": 220},
                "agencyName": {"kind": "text", "limit": 160},
                "stanceText": {"kind": "text", "limit": 500},
                "stanceSummary": {"kind": "text", "limit": 280},
                "polarity": {
                    "kind": "enum",
                    "allowed": polarity_allowed,
                    "default": "unknown",
                },
                "effectiveDateText": {"kind": "text", "limit": 80},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("positions") or [])
    ]
    positions = [
        item
        for item in positions
        if item and item.get("agencyName") and item.get("stanceText")
    ]
    positions = _dedupe_governance_items(
        positions, key_fields=["agencyName", "stanceText"], limit=60
    )

    gaps = [
        _normalize_governance_item(
            raw,
            spec={
                "issueTitle": {"kind": "text", "limit": 220},
                "primaryAgencyName": {"kind": "text", "limit": 160},
                "secondaryAgencyName": {"kind": "text", "limit": 160},
                "gapType": {"kind": "enum", "allowed": gap_allowed, "default": "other"},
                "summary": {"kind": "text", "limit": 320},
                "severity": {"kind": "confidence"},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("gaps") or [])
    ]
    gaps = [item for item in gaps if item and item.get("summary")]
    gaps = _dedupe_governance_items(gaps, key_fields=["gapType", "summary"], limit=32)

    relations = [
        _normalize_governance_item(
            raw,
            spec={
                "issueTitle": {"kind": "text", "limit": 220},
                "fromAgencyName": {"kind": "text", "limit": 160},
                "toAgencyName": {"kind": "text", "limit": 160},
                "fromClaimText": {"kind": "text", "limit": 320},
                "toClaimText": {"kind": "text", "limit": 320},
                "relationType": {
                    "kind": "enum",
                    "allowed": relation_allowed,
                    "default": "other",
                },
                "rationale": {"kind": "text", "limit": 320},
                "confidence": {"kind": "confidence"},
            },
        )
        for raw in (governance.get("relations") or [])
    ]
    relations = [
        item
        for item in relations
        if item
        and item.get("relationType")
        and (item.get("fromClaimText") or item.get("fromAgencyName"))
        and (item.get("toClaimText") or item.get("toAgencyName"))
    ]
    relations = _dedupe_governance_items(
        relations,
        key_fields=[
            "relationType",
            "fromClaimText",
            "toClaimText",
            "fromAgencyName",
            "toAgencyName",
        ],
        limit=48,
    )

    return {
        "profile": "governance",
        "version": 1,
        "agencies": agencies,
        "issues": issues,
        "mandates": mandates,
        "claims": claims,
        "events": events,
        "positions": positions,
        "gaps": gaps,
        "relations": relations,
    }


def _ground_governance(governance: Any, units: Sequence[Dict[str, Any]]) -> Any:
    if not governance or not isinstance(governance, dict) or not units:
        return governance

    for key in (
        "agencies",
        "issues",
        "mandates",
        "claims",
        "events",
        "positions",
        "gaps",
        "relations",
    ):
        arr = governance.get(key)
        if isinstance(arr, list):
            governance[key] = [_ground_evidence_dict(item, units) for item in arr]

    return governance


def _classify_structured_combined(
    *,
    content: str,
    file_name: Optional[str],
    tags: List[str],
    extraction: Optional[Dict[str, Any]],
    grounding_units: Sequence[Dict[str, Any]],
    allow_llm: bool,
):
    rule_structured = _classify_structured_safe(content, file_name, tags) or None

    llm_structured = None
    structured_llm_used = False
    structured_llm_model: Optional[str] = None

    if allow_llm and has_structured_llm() and (content or "").strip():
        try:
            llm_structured = extract_structured_with_llm(
                content=content,
                file_name=file_name,
                tags=tags,
                extraction=extraction,
                grounding_units=grounding_units,
            )
            if llm_structured:
                structured_llm_used = True
                structured_llm_model = get_structured_model()
        except Exception as e:
            log.warning("structured llm failed: %s", e)

    structured = (
        merge_structured(llm_structured, rule_structured)
        if llm_structured
        else rule_structured
    )
    structured = _ground_structured(structured, grounding_units)

    governance = None
    governance_llm_used = False
    governance_llm_model: Optional[str] = None

    if allow_llm and has_structured_llm() and (content or "").strip():
        try:
            governance = extract_governance_with_llm(
                content=content,
                file_name=file_name,
                tags=tags,
                extraction=extraction,
                grounding_units=grounding_units,
            )
            if governance:
                governance_llm_used = True
                governance_llm_model = get_structured_model()
        except Exception as e:
            log.warning("governance llm failed: %s", e)

    governance = _normalize_governance(governance)
    governance = _ground_governance(governance, grounding_units)

    return (
        structured,
        structured_llm_used,
        structured_llm_model,
        governance,
        governance_llm_used,
        governance_llm_model,
    )


def _tag_display(value: Any) -> str:
    raw = _clean_text(value, 120) or ""
    display_map = {
        "caqm": "CAQM",
        "cpcb": "CPCB",
        "dpcc": "DPCC",
        "spcb": "SPCB",
        "imd": "IMD",
        "iit": "IIT",
        "ncr": "NCR",
        "delhi": "Delhi",
        "uttar_pradesh": "Uttar Pradesh",
        "construction_demolition": "C&D",
        "waste_burning": "Waste burning",
        "biomass_burning": "Biomass burning",
        "industry_power": "Industry & power",
        "dg_sets": "DG sets",
        "office_memorandum": "Office memorandum",
        "sop_guideline": "SOP / Guideline",
        "pm2.5": "PM2.5",
        "pm25": "PM2.5",
        "pm10": "PM10",
        "no2": "NO2",
        "o3": "O3",
        "co": "CO",
        "grap": "GRAP",
    }
    return display_map.get(raw, raw.replace("_", " "))


def _snippet_for_term(
    term: str,
    content: str,
    units: Sequence[Dict[str, Any]],
    *,
    window: int = 90,
) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    needle = (term or "").strip().casefold()
    if not needle:
        return None, None

    for unit in units or []:
        text = str(unit.get("text") or "")
        idx = text.casefold().find(needle)
        if idx < 0:
            continue
        start = max(0, idx - window)
        end = min(len(text), idx + len(term) + window)
        snippet = " ".join(text[start:end].split()).strip()
        if not snippet:
            continue
        if start > 0:
            snippet = "... " + snippet
        if end < len(text):
            snippet = snippet + " ..."
        return _locator_prefix(unit.get("locator") or {}) + snippet, unit.get("locator")

    idx = (content or "").casefold().find(needle)
    if idx < 0:
        return None, None
    start = max(0, idx - window)
    end = min(len(content), idx + len(term) + window)
    snippet = " ".join(content[start:end].split()).strip()
    if start > 0:
        snippet = "... " + snippet
    if end < len(content):
        snippet = snippet + " ..."
    return "[document] " + snippet, None


def _candidate_hints(
    *,
    signals: Sequence[str],
    adv: Sequence[str],
    phrases: Sequence[str],
    unigrams: Sequence[str],
) -> Dict[str, Dict[str, Any]]:
    hints: Dict[str, Dict[str, Any]] = {}

    def add(items: Sequence[str], source: str, confidence: float) -> None:
        for item in items or []:
            mapped = apply_taxonomy([item])
            value = mapped[0] if mapped else _clean_text(item, 120)
            if not value:
                continue
            key = str(value).casefold()
            prev = hints.get(key)
            if prev and float(prev.get("confidence") or 0) >= confidence:
                continue
            hints[key] = {"source": source, "confidence": confidence}

    add(signals, "signal", 0.68)
    add(adv, "semantic_candidate", 0.7)
    add(phrases, "phrase_candidate", 0.62)
    add(unigrams, "keyword_candidate", 0.55)
    return hints


def _iter_structured_tag_items(
    structured: Any,
) -> Sequence[Tuple[str, str, Dict[str, Any]]]:
    if not isinstance(structured, dict):
        return []

    out: List[Tuple[str, str, Dict[str, Any]]] = []

    doc_type = structured.get("docType")
    if isinstance(doc_type, dict) and doc_type.get("value"):
        out.append(("document_type", str(doc_type.get("value")), doc_type))

    labels = structured.get("labels")
    label_type_by_key = {
        "sectors": "sector",
        "agencies": "agency",
        "geography": "geography",
        "programs": "program",
        "pollutants": "pollutant",
    }
    if isinstance(labels, dict):
        for key, tag_type in label_type_by_key.items():
            arr = labels.get(key)
            if not isinstance(arr, list):
                continue
            for item in arr:
                if isinstance(item, dict) and item.get("value"):
                    out.append((tag_type, str(item.get("value")), item))

    grap = structured.get("grap")
    if isinstance(grap, dict) and grap.get("mentioned"):
        out.append(
            (
                "program",
                "grap",
                {
                    "value": "grap",
                    "score": 0.85 if grap.get("stage") else 0.7,
                    "evidence": grap.get("evidence") or "",
                    "locator": grap.get("locator"),
                },
            )
        )
        if grap.get("stage"):
            out.append(
                (
                    "program_stage",
                    f"grap stage {grap.get('stage')}",
                    {
                        "value": f"grap stage {grap.get('stage')}",
                        "score": 0.85,
                        "evidence": grap.get("evidence") or "",
                        "locator": grap.get("locator"),
                    },
                )
            )

    return out


def _build_ai_tag_details(
    *,
    tags: Sequence[str],
    structured: Any,
    signals: Sequence[str],
    adv: Sequence[str],
    phrases: Sequence[str],
    unigrams: Sequence[str],
    content: str,
    grounding_units: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    hints = _candidate_hints(
        signals=signals,
        adv=adv,
        phrases=phrases,
        unigrams=unigrams,
    )

    structured_lookup: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    for tag_type, value, item in _iter_structured_tag_items(structured):
        structured_lookup[str(value).casefold()] = (tag_type, item)

    out: List[Dict[str, Any]] = []
    seen = set()

    def add(
        value: Any,
        *,
        tag_type: str,
        source: str,
        confidence: Optional[float],
        evidence: Optional[str] = None,
        locator: Optional[Dict[str, Any]] = None,
        rank: Optional[int] = None,
    ) -> None:
        raw = _clean_text(value, 120)
        if not raw:
            return
        key = (tag_type, raw.casefold())
        if key in seen:
            return
        seen.add(key)

        ev = _clean_text(evidence, 500)
        loc = locator if isinstance(locator, dict) else None
        if not ev:
            ev, loc = _snippet_for_term(raw, content, grounding_units)

        item: Dict[str, Any] = {
            "value": raw,
            "display": _tag_display(raw),
            "type": tag_type,
            "source": source,
            "confidence": _clean_confidence(confidence),
            "evidence": ev,
            "locator": loc,
        }
        if rank is not None:
            item["rank"] = rank
        out.append(item)

    for idx, tag in enumerate(tags or [], start=1):
        value = _clean_text(tag, 120)
        if not value:
            continue

        lookup = structured_lookup.get(value.casefold())
        if lookup:
            tag_type, structured_item = lookup
            add(
                value,
                tag_type=tag_type,
                source="structured",
                confidence=structured_item.get("score"),
                evidence=structured_item.get("evidence"),
                locator=structured_item.get("locator"),
                rank=idx,
            )
            continue

        hint = hints.get(value.casefold()) or {}
        add(
            value,
            tag_type="keyword",
            source=str(hint.get("source") or "ranked_keyword"),
            confidence=float(hint.get("confidence") or 0.52),
            rank=idx,
        )

    for tag_type, value, structured_item in _iter_structured_tag_items(structured):
        add(
            value,
            tag_type=tag_type,
            source="structured",
            confidence=structured_item.get("score"),
            evidence=structured_item.get("evidence"),
            locator=structured_item.get("locator"),
        )

    return out[:80]


_SMART_CATEGORY_TAXONOMY = "Taxonomy Tags"
_SMART_CATEGORY_DISCOVERED = "AI-Discovered Tags"
_SMART_CATEGORY_TOPICS = "Topics"
_SMART_CATEGORY_ENTITIES = "Entities"
_SMART_CATEGORY_DOC_TYPE = "Document Type"
_SMART_CATEGORY_ACTIONS = "Actions / Decisions"
_SMART_CATEGORY_USER = "User Tags"

_SMART_ENTITY_BUCKETS = {
    "agency": "agencies",
    "organization": "organizations",
    "location": "locations",
    "person": "people",
    "legal_reference": "legalReferences",
    "scheme_program": "schemesPrograms",
    "date_deadline": "datesDeadlines",
}

_SMART_BAD_TAGS = {
    "document",
    "report",
    "information",
    "data",
    "important",
    "introduction",
    "background",
    "order",
    "page",
    "section",
    "content",
    "official",
    "government",
    "matter",
    "details",
}

_SMART_DOC_TYPE_DISPLAY = {
    "direction": "Government Direction",
    "order": "Government Order",
    "office_memorandum": "Office Memorandum",
    "notice": "Notification / Notice",
    "minutes": "Meeting Minutes",
    "sop_guideline": "Guideline / SOP",
}

_SMART_TAXONOMY_VALUES = {
    "caqm",
    "commission for air quality management",
    "cpcb",
    "central pollution control board",
    "dpcc",
    "delhi pollution control committee",
    "spcb",
    "state pollution control board",
    "imd",
    "india meteorological department",
    "iit",
    "grap",
    "graded response action plan",
    "pm2.5",
    "pm25",
    "pm10",
    "no2",
    "o3",
    "co",
    "delhi",
    "ncr",
    "national capital region",
    "haryana",
    "uttar pradesh",
    "rajasthan",
    "construction_demolition",
    "waste_burning",
    "biomass_burning",
    "industry_power",
    "dg_sets",
    "transport",
}

_SMART_LOCATOR_PREFIX_RE = re.compile(
    r"^\[(?:page\s+(\d+)|document|image(?:\s+frame)?(?:\s+\d+)?)\]\s*",
    re.IGNORECASE,
)

_SMART_DISCOVERY_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "Construction Dust Control",
        "control_measure",
        [
            re.compile(r"\bconstruction\b.{0,90}\bdust\b", re.IGNORECASE | re.DOTALL),
            re.compile(r"\bC\s*&\s*D\b.{0,90}\bdust\b", re.IGNORECASE | re.DOTALL),
            re.compile(
                r"\bconstruction\s+and\s+demolition\b.{0,90}\b(debris|waste|dust)\b",
                re.IGNORECASE | re.DOTALL,
            ),
        ],
        0.86,
    ),
    (
        "Diesel Generator Restrictions",
        "restriction",
        [
            re.compile(
                r"\b(?:DG\s*sets?|diesel\s+generators?|gensets?)\b.{0,100}\b"
                r"(?:ban|banned|restrict|restricted|prohibit|not\s+permitted|regulated)\b",
                re.IGNORECASE | re.DOTALL,
            ),
            re.compile(
                r"\b(?:ban|restrict|prohibit|not\s+permitted)\b.{0,100}\b"
                r"(?:DG\s*sets?|diesel\s+generators?|gensets?)\b",
                re.IGNORECASE | re.DOTALL,
            ),
        ],
        0.88,
    ),
    (
        "Road Dust Mitigation",
        "control_measure",
        [
            re.compile(
                r"\broad\s+dust\b.{0,100}\b(?:mitigation|control|suppression|sweeping|sprinkling)\b",
                re.IGNORECASE | re.DOTALL,
            ),
            re.compile(
                r"\b(?:mechanized\s+)?road\s+sweeping\b|\bwater\s+sprinkling\b",
                re.IGNORECASE,
            ),
        ],
        0.82,
    ),
    (
        "Emergency Air Quality Response",
        "emergency_response",
        [
            re.compile(
                r"\b(?:emergency|severe|very\s+poor)\b.{0,100}\b(?:air\s+quality|pollution|response|measures)\b",
                re.IGNORECASE | re.DOTALL,
            ),
            re.compile(r"\bGRAP\s+Stage\s*(?:I|II|III|IV|1|2|3|4)\b", re.IGNORECASE),
        ],
        0.84,
    ),
    (
        "Industrial Emissions Inspection",
        "inspection",
        [
            re.compile(
                r"\b(?:industrial|industry|stack)\b.{0,100}\b(?:emissions?|inspection|inspect|compliance)\b",
                re.IGNORECASE | re.DOTALL,
            )
        ],
        0.82,
    ),
    (
        "Winter Pollution Episode",
        "seasonal_episode",
        [
            re.compile(
                r"\bwinter\b.{0,100}\b(?:pollution|episode|air\s+quality|smog)\b",
                re.IGNORECASE | re.DOTALL,
            )
        ],
        0.78,
    ),
    (
        "Open Waste Burning",
        "emission_source",
        [
            re.compile(r"\bopen\s+burning\b|\bgarbage\s+burning\b|\bwaste\s+burning\b", re.IGNORECASE)
        ],
        0.8,
    ),
    (
        "Stubble Burning",
        "emission_source",
        [
            re.compile(r"\bstubble\s+burning\b|\bcrop\s+residue\b|\bpaddy\s+straw\b|\bparali\b", re.IGNORECASE)
        ],
        0.8,
    ),
]

_SMART_TOPIC_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "Air Pollution Control",
        "environmental_topic",
        [
            re.compile(r"\bair\s+pollution\b|\bair\s+quality\b|\bAQI\b|\bPM\s*2\.?5\b|\bPM\s*10\b", re.IGNORECASE)
        ],
        0.76,
    ),
    (
        "Urban Governance",
        "governance_topic",
        [
            re.compile(
                r"\b(?:municipal|urban|local\s+bod(?:y|ies)|implementation\s+agency|district\s+administration)\b",
                re.IGNORECASE,
            )
        ],
        0.7,
    ),
    (
        "Public Health",
        "health_topic",
        [
            re.compile(r"\bpublic\s+health\b|\bhealth\s+advisory\b|\brespiratory\b|\bvulnerable\s+groups\b", re.IGNORECASE)
        ],
        0.7,
    ),
    (
        "Industrial Regulation",
        "regulatory_topic",
        [
            re.compile(r"\bindustr(?:y|ial)\b.{0,90}\b(?:emissions?|compliance|inspection|fuel)\b", re.IGNORECASE | re.DOTALL)
        ],
        0.72,
    ),
    (
        "Environmental Compliance",
        "compliance_topic",
        [
            re.compile(r"\bcompliance\b|\benvironment(?:al)?\s+compensation\b|\bviolation\b|\benforcement\b", re.IGNORECASE)
        ],
        0.72,
    ),
]

_SMART_ACTION_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "Restriction",
        "restriction",
        [
            re.compile(r"\b(?:restrict|restriction|restricted|suspend|suspended|curb|curbs)\b", re.IGNORECASE)
        ],
        0.78,
    ),
    (
        "Ban",
        "ban",
        [
            re.compile(r"\b(?:ban|banned|prohibit|prohibited|not\s+permitted)\b", re.IGNORECASE)
        ],
        0.82,
    ),
    (
        "Compliance Required",
        "compliance_required",
        [
            re.compile(r"\b(?:shall\s+ensure|directed\s+to|comply|compliance\s+required|submit\s+compliance)\b", re.IGNORECASE)
        ],
        0.8,
    ),
    (
        "Inspection Required",
        "inspection_required",
        [
            re.compile(r"\b(?:inspection|inspect|inspected|inspection\s+drive)\b", re.IGNORECASE)
        ],
        0.76,
    ),
    (
        "Monitoring Required",
        "monitoring_required",
        [
            re.compile(r"\b(?:monitor|monitoring|surveillance|real[-\s]?time\s+monitoring)\b", re.IGNORECASE)
        ],
        0.74,
    ),
    (
        "Deadline",
        "deadline",
        [
            re.compile(r"\b(?:by|before|within|not\s+later\s+than)\s+(?:\d{1,2}\s+\w+\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d+\s+days?)\b", re.IGNORECASE)
        ],
        0.74,
    ),
    (
        "Implementation Plan",
        "implementation_plan",
        [
            re.compile(r"\b(?:implementation\s+plan|action\s+plan|roadmap|time[-\s]?bound\s+plan)\b", re.IGNORECASE)
        ],
        0.76,
    ),
    (
        "Advisory",
        "advisory",
        [
            re.compile(r"\b(?:advisory|advised|advises|citizens\s+are\s+advised)\b", re.IGNORECASE)
        ],
        0.72,
    ),
]

_SMART_ORG_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "National Green Tribunal",
        "organization",
        [
            re.compile(r"\bNational\s+Green\s+Tribunal\b|\bNGT\b", re.IGNORECASE)
        ],
        0.84,
    ),
    (
        "Supreme Court of India",
        "organization",
        [
            re.compile(r"\bSupreme\s+Court(?:\s+of\s+India)?\b", re.IGNORECASE)
        ],
        0.82,
    ),
    (
        "Delhi High Court",
        "organization",
        [
            re.compile(r"\bDelhi\s+High\s+Court\b", re.IGNORECASE)
        ],
        0.82,
    ),
]

_SMART_LEGAL_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "Environment Protection Act",
        "statute",
        [
            re.compile(r"\bEnvironment\s*\(Protection\)\s*Act\b|\bEnvironment\s+Protection\s+Act\b", re.IGNORECASE)
        ],
        0.86,
    ),
    (
        "Air Act",
        "statute",
        [
            re.compile(r"\bAir\s*\(Prevention\s+and\s+Control\s+of\s+Pollution\)\s*Act\b|\bAir\s+Act\b", re.IGNORECASE)
        ],
        0.86,
    ),
    (
        "CAQM Act",
        "statute",
        [
            re.compile(r"\bCAQM\s+Act\b|\bCommission\s+for\s+Air\s+Quality\s+Management\s+Act\b", re.IGNORECASE)
        ],
        0.86,
    ),
]

_SMART_PROGRAM_RULES: Sequence[Tuple[str, str, Sequence[re.Pattern], float]] = [
    (
        "National Clean Air Programme",
        "scheme_program",
        [
            re.compile(r"\bNational\s+Clean\s+Air\s+Programme\b|\bNCAP\b", re.IGNORECASE)
        ],
        0.82,
    ),
    (
        "Graded Response Action Plan",
        "scheme_program",
        [
            re.compile(r"\bGraded\s+Response\s+Action\s+Plan\b|\bGRAP\b", re.IGNORECASE)
        ],
        0.86,
    ),
]

_SMART_PERSON_RE = re.compile(
    r"\b(?:Shri|Smt|Ms|Mrs|Mr|Dr|Justice)\.?\s+[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3}\b"
)

_SMART_LOCATION_PATTERNS: Sequence[Tuple[str, Sequence[re.Pattern], float]] = [
    ("Delhi-NCR", [re.compile(r"\bDelhi[-\s]?NCR\b", re.IGNORECASE)], 0.86),
    ("National Capital Region", [re.compile(r"\bNational\s+Capital\s+Region\b|\bNCR\b", re.IGNORECASE)], 0.82),
    ("NCT of Delhi", [re.compile(r"\bNCT\s+of\s+Delhi\b", re.IGNORECASE)], 0.82),
]


def _confidence_band(value: Any) -> str:
    score = _clean_confidence(value)
    if score is None:
        return "low"
    if score >= 0.85:
        return "high"
    if score >= 0.6:
        return "medium"
    return "low"


def _smart_key(value: Any) -> str:
    raw = _clean_text(value, 160) or ""
    raw = raw.lower().replace("&", " and ")
    raw = re.sub(r"[^a-z0-9.]+", " ", raw)
    raw = re.sub(r"\b(?:the|and|of|for|under)\b", " ", raw)
    return " ".join(raw.split()).strip()


def _smart_display(value: Any, category: str) -> str:
    raw = _clean_text(value, 120) or ""
    if category == _SMART_CATEGORY_DOC_TYPE:
        mapped = _SMART_DOC_TYPE_DISPLAY.get(raw)
        if mapped:
            return mapped

    display = _tag_display(raw)
    if "_" in raw and display == raw.replace("_", " "):
        return display.title()
    if display == raw and raw.islower() and " " in raw:
        return display.title()
    return display


def _smart_quote_and_page(
    evidence: Any,
    locator: Optional[Dict[str, Any]],
) -> Tuple[Optional[str], Optional[int]]:
    raw = _clean_text(evidence, 700)
    if not raw:
        return None, None

    page: Optional[int] = None
    m = _SMART_LOCATOR_PREFIX_RE.match(raw)
    if m:
        if m.group(1):
            try:
                page = int(m.group(1))
            except ValueError:
                page = None
        raw = raw[m.end() :].strip()

    loc = locator if isinstance(locator, dict) else {}
    if page is None and loc.get("pageNumber") is not None:
        try:
            page = int(loc.get("pageNumber"))
        except (TypeError, ValueError):
            page = None

    return raw, page


def _smart_evidence_list(
    evidence: Any,
    locator: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    quote, page = _smart_quote_and_page(evidence, locator)
    if not quote:
        return []

    item: Dict[str, Any] = {"quote": quote}
    if page is not None:
        item["page"] = page

    loc = locator if isinstance(locator, dict) else {}
    section = loc.get("section") or loc.get("heading")
    if section:
        item["section"] = _clean_text(section, 160)
    if loc:
        item["locator"] = loc

    return [item]


def _smart_quality_ok(
    value: str,
    *,
    category: str,
    tag_type: str,
    evidence: Sequence[Dict[str, Any]],
) -> bool:
    raw = _clean_text(value, 120) or ""
    if not raw:
        return False

    key = _smart_key(raw)
    if category in (_SMART_CATEGORY_DISCOVERED, _SMART_CATEGORY_TOPICS) and key in _SMART_BAD_TAGS:
        return False

    if category != _SMART_CATEGORY_USER and not evidence:
        return False

    if len(raw) < 3 and not raw.isupper():
        return False

    words = [w for w in re.split(r"\s+", raw) if w]
    if category == _SMART_CATEGORY_DISCOVERED:
        if len(words) == 1 and not raw.isupper() and not re.search(r"\d", raw):
            return False
        if len(words) > 8 or len(raw) > 90:
            return False

    if tag_type == "keyword" and key in _SMART_BAD_TAGS:
        return False

    return True


def _smart_snippet_from_span(
    text: str,
    start: int,
    end: int,
    *,
    window: int = 130,
) -> str:
    a = max(0, start - window)
    b = min(len(text), end + window)
    snippet = " ".join((text or "")[a:b].split()).strip()
    if a > 0:
        snippet = "... " + snippet
    if b < len(text):
        snippet = snippet + " ..."
    return snippet


def _smart_candidate_units(
    content: str,
    grounding_units: Sequence[Dict[str, Any]],
    *,
    max_chars: int = 3600,
    overlap: int = 280,
) -> List[Dict[str, Any]]:
    base_units = list(grounding_units or [])
    if not base_units and (content or "").strip():
        base_units = [{"text": content, "locator": {"kind": "document"}}]

    out: List[Dict[str, Any]] = []
    for unit in base_units:
        text = str(unit.get("text") or "").strip()
        if not text:
            continue

        locator = unit.get("locator") if isinstance(unit.get("locator"), dict) else {}
        if len(text) <= max_chars:
            out.append({"text": text, "locator": dict(locator)})
            continue

        start = 0
        idx = 1
        while start < len(text):
            end = min(len(text), start + max_chars)
            if end < len(text):
                split_at = text.rfind("\n", start + int(max_chars * 0.55), end)
                if split_at > start:
                    end = split_at

            chunk = text[start:end].strip()
            if chunk:
                loc = dict(locator)
                loc["chunkIndex"] = idx
                out.append({"text": chunk, "locator": loc})
                idx += 1

            if end >= len(text):
                break
            start = max(end - overlap, start + 1)

    return out[:160]


def _first_rule_match(
    units: Sequence[Dict[str, Any]],
    patterns: Sequence[re.Pattern],
) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    for unit in units:
        text = str(unit.get("text") or "")
        if not text:
            continue
        for pat in patterns:
            m = pat.search(text)
            if not m:
                continue
            return _smart_snippet_from_span(text, m.start(), m.end()), unit.get("locator")
    return None, None


def _add_rule_tags(
    *,
    add,
    units: Sequence[Dict[str, Any]],
    rules: Sequence[Tuple[str, str, Sequence[re.Pattern], float]],
    category: str,
    source: str,
) -> None:
    for value, tag_type, patterns, confidence in rules:
        evidence, locator = _first_rule_match(units, patterns)
        if evidence:
            add(
                value,
                category=category,
                tag_type=tag_type,
                source=source,
                confidence=confidence,
                evidence=evidence,
                locator=locator,
            )


def _is_known_taxonomy_tag(value: Any) -> bool:
    raw = _clean_text(value, 120)
    if not raw:
        return False

    keys = {_smart_key(raw), raw.strip().casefold()}
    mapped = apply_taxonomy([raw])
    for item in mapped:
        keys.add(_smart_key(item))
        keys.add(str(item).strip().casefold())

    return any(k in _SMART_TAXONOMY_VALUES for k in keys if k)


def _build_smart_tags(
    *,
    tags: Sequence[str],
    tag_details: Sequence[Dict[str, Any]],
    structured: Any,
    content: str,
    grounding_units: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    units = _smart_candidate_units(content, grounding_units)
    items_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add(
        value: Any,
        *,
        category: str,
        tag_type: str,
        source: str,
        confidence: Any,
        evidence: Any = None,
        locator: Optional[Dict[str, Any]] = None,
        matched_taxonomy: Optional[str] = None,
        status: Optional[str] = None,
    ) -> None:
        display = _smart_display(value, category)
        ev = _smart_evidence_list(evidence, locator)
        if not ev and category != _SMART_CATEGORY_USER:
            found_ev, found_loc = _snippet_for_term(str(value), content, grounding_units)
            ev = _smart_evidence_list(found_ev, found_loc)

        if not _smart_quality_ok(display, category=category, tag_type=tag_type, evidence=ev):
            return

        clean_conf = _clean_confidence(confidence)
        if clean_conf is None:
            clean_conf = 0.55

        key = (category, _smart_key(display))
        existing = items_by_key.get(key)
        if existing:
            if clean_conf > float(existing.get("confidence") or 0):
                existing["confidence"] = round(clean_conf, 3)
                existing["confidenceBand"] = _confidence_band(clean_conf)
            seen_quotes = {
                _smart_key(item.get("quote"))
                for item in existing.get("evidence", [])
                if isinstance(item, dict)
            }
            for ev_item in ev:
                ev_key = _smart_key(ev_item.get("quote"))
                if ev_key and ev_key not in seen_quotes:
                    existing.setdefault("evidence", []).append(ev_item)
                    seen_quotes.add(ev_key)
            return

        items_by_key[key] = {
            "value": display,
            "category": category,
            "type": tag_type,
            "source": source,
            "confidence": round(clean_conf, 3),
            "confidenceBand": _confidence_band(clean_conf),
            "matchedTaxonomy": matched_taxonomy,
            "status": status
            or ("matched" if category == _SMART_CATEGORY_TAXONOMY else "suggested"),
            "evidence": ev[:3],
        }

    for tag_type, value, item in _iter_structured_tag_items(structured):
        evidence = item.get("evidence") if isinstance(item, dict) else None
        locator = item.get("locator") if isinstance(item, dict) else None
        confidence = item.get("score") if isinstance(item, dict) else 0.7

        if tag_type == "document_type":
            add(
                value,
                category=_SMART_CATEGORY_DOC_TYPE,
                tag_type="document_type",
                source="taxonomy",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
                matched_taxonomy=str(value),
                status="matched",
            )
            continue

        add(
            value,
            category=_SMART_CATEGORY_TAXONOMY,
            tag_type=tag_type,
            source="taxonomy",
            confidence=confidence,
            evidence=evidence,
            locator=locator,
            matched_taxonomy=str(value),
            status="matched",
        )

        if tag_type == "agency":
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="agency",
                source="taxonomy",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
                matched_taxonomy=str(value),
                status="matched",
            )
        elif tag_type == "geography":
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="location",
                source="taxonomy",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
                matched_taxonomy=str(value),
                status="matched",
            )
        elif tag_type in ("program", "program_stage"):
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="scheme_program",
                source="taxonomy",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
                matched_taxonomy=str(value),
                status="matched",
            )

    structured_entities = (
        structured.get("entities") if isinstance(structured, dict) else {}
    )
    if isinstance(structured_entities, dict):
        for raw in structured_entities.get("directionNumbers") or []:
            label = str(raw).strip()
            if not label:
                continue
            value = label if label.lower().startswith("direction") else f"Direction No. {label}"
            evidence, locator = _snippet_for_term(label, content, grounding_units)
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="legal_reference",
                source="deterministic",
                confidence=0.78,
                evidence=evidence,
                locator=locator,
            )

        for raw in structured_entities.get("orderNumbers") or []:
            label = str(raw).strip()
            if not label:
                continue
            value = label if label.lower().startswith("order") else f"Order No. {label}"
            evidence, locator = _snippet_for_term(label, content, grounding_units)
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="legal_reference",
                source="deterministic",
                confidence=0.76,
                evidence=evidence,
                locator=locator,
            )

        for raw in structured_entities.get("referenceNumbers") or []:
            label = str(raw).strip()
            if not label:
                continue
            evidence, locator = _snippet_for_term(label, content, grounding_units)
            add(
                f"Reference No. {label}",
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="legal_reference",
                source="deterministic",
                confidence=0.72,
                evidence=evidence,
                locator=locator,
            )

        for raw in structured_entities.get("dates") or []:
            label = str(raw).strip()
            if not label:
                continue
            evidence, locator = _snippet_for_term(label, content, grounding_units)
            add(
                label,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="date_deadline",
                source="deterministic",
                confidence=0.68,
                evidence=evidence,
                locator=locator,
            )

    for detail in tag_details or []:
        if not isinstance(detail, dict):
            continue
        value = _clean_text(detail.get("value"), 120)
        if not value:
            continue
        tag_type = _clean_text(detail.get("type"), 80) or "keyword"
        source = _clean_text(detail.get("source"), 80) or "tagger"
        evidence = detail.get("evidence")
        locator = detail.get("locator") if isinstance(detail.get("locator"), dict) else None
        confidence = detail.get("confidence")
        detail_confidence = _clean_confidence(confidence) or 0.0

        if source == "structured" or tag_type in {"agency", "program", "pollutant", "sector", "geography", "program_stage"}:
            continue

        if _is_known_taxonomy_tag(value):
            add(
                value,
                category=_SMART_CATEGORY_TAXONOMY,
                tag_type=tag_type,
                source="taxonomy",
                confidence=confidence or 0.68,
                evidence=evidence,
                locator=locator,
                matched_taxonomy=value,
                status="matched",
            )
        else:
            if tag_type == "keyword" and source != "semantic_candidate" and detail_confidence < 0.7:
                continue
            add(
                value,
                category=_SMART_CATEGORY_DISCOVERED,
                tag_type=tag_type,
                source="ai_discovered",
                confidence=confidence or 0.58,
                evidence=evidence,
                locator=locator,
            )

    for tag in tags or []:
        if not _is_known_taxonomy_tag(tag):
            continue
        evidence, locator = _snippet_for_term(str(tag), content, grounding_units)
        add(
            tag,
            category=_SMART_CATEGORY_TAXONOMY,
            tag_type="keyword",
            source="taxonomy",
            confidence=0.64,
            evidence=evidence,
            locator=locator,
            matched_taxonomy=str(tag),
            status="matched",
        )

    _add_rule_tags(
        add=add,
        units=units,
        rules=_SMART_DISCOVERY_RULES,
        category=_SMART_CATEGORY_DISCOVERED,
        source="ai_discovered",
    )
    _add_rule_tags(
        add=add,
        units=units,
        rules=_SMART_TOPIC_RULES,
        category=_SMART_CATEGORY_TOPICS,
        source="deterministic",
    )
    _add_rule_tags(
        add=add,
        units=units,
        rules=_SMART_ACTION_RULES,
        category=_SMART_CATEGORY_ACTIONS,
        source="deterministic",
    )
    _add_rule_tags(
        add=add,
        units=units,
        rules=_SMART_ORG_RULES,
        category=_SMART_CATEGORY_ENTITIES,
        source="deterministic",
    )
    for value, tag_type, patterns, confidence in _SMART_LEGAL_RULES:
        evidence, locator = _first_rule_match(units, patterns)
        if evidence:
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="legal_reference",
                source="deterministic",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
            )
    for value, tag_type, patterns, confidence in _SMART_PROGRAM_RULES:
        evidence, locator = _first_rule_match(units, patterns)
        if evidence:
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="scheme_program",
                source="deterministic",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
            )
    for value, patterns, confidence in _SMART_LOCATION_PATTERNS:
        evidence, locator = _first_rule_match(units, patterns)
        if evidence:
            add(
                value,
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="location",
                source="deterministic",
                confidence=confidence,
                evidence=evidence,
                locator=locator,
            )

    for unit in units:
        text = str(unit.get("text") or "")
        for m in _SMART_PERSON_RE.finditer(text):
            evidence = _smart_snippet_from_span(text, m.start(), m.end(), window=70)
            add(
                m.group(0),
                category=_SMART_CATEGORY_ENTITIES,
                tag_type="person",
                source="deterministic",
                confidence=0.68,
                evidence=evidence,
                locator=unit.get("locator"),
            )

    all_items = sorted(
        items_by_key.values(),
        key=lambda item: (
            [
                _SMART_CATEGORY_TAXONOMY,
                _SMART_CATEGORY_DISCOVERED,
                _SMART_CATEGORY_TOPICS,
                _SMART_CATEGORY_ENTITIES,
                _SMART_CATEGORY_DOC_TYPE,
                _SMART_CATEGORY_ACTIONS,
                _SMART_CATEGORY_USER,
            ].index(str(item.get("category")))
            if item.get("category")
            in {
                _SMART_CATEGORY_TAXONOMY,
                _SMART_CATEGORY_DISCOVERED,
                _SMART_CATEGORY_TOPICS,
                _SMART_CATEGORY_ENTITIES,
                _SMART_CATEGORY_DOC_TYPE,
                _SMART_CATEGORY_ACTIONS,
                _SMART_CATEGORY_USER,
            }
            else 99,
            -float(item.get("confidence") or 0),
            str(item.get("value") or ""),
        ),
    )

    def by_category(category: str, limit: int) -> List[Dict[str, Any]]:
        return [item for item in all_items if item.get("category") == category][:limit]

    entities: Dict[str, List[Dict[str, Any]]] = {
        bucket: [] for bucket in _SMART_ENTITY_BUCKETS.values()
    }
    for item in by_category(_SMART_CATEGORY_ENTITIES, 80):
        bucket = _SMART_ENTITY_BUCKETS.get(str(item.get("type") or ""))
        if bucket:
            entities[bucket].append(item)

    ai_discovered = by_category(_SMART_CATEGORY_DISCOVERED, 30)
    taxonomy_suggestions = [
        {
            **item,
            "status": "candidate_taxonomy_addition",
            "source": "ai_discovered",
        }
        for item in ai_discovered
        if float(item.get("confidence") or 0) >= 0.7
    ][:12]

    return {
        "profile": "smart_tags",
        "version": 1,
        "taxonomyTags": by_category(_SMART_CATEGORY_TAXONOMY, 40),
        "aiDiscoveredTags": ai_discovered,
        "topics": by_category(_SMART_CATEGORY_TOPICS, 16),
        "entities": entities,
        "documentType": by_category(_SMART_CATEGORY_DOC_TYPE, 4),
        "actionsDecisions": by_category(_SMART_CATEGORY_ACTIONS, 24),
        "userTags": [],
        "taxonomySuggestions": taxonomy_suggestions,
        "items": all_items[:140],
    }


def extract_and_tag_sync(
    *,
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
    ocr_options: Optional[Dict[str, Any]] = None,
    topk: int = 20,
    use_llm: bool = False,
) -> Dict[str, Any]:
    """
    Deterministic + OCR-aware + model-assisted tagging pipeline.
    Keeps the existing structured CAQM label schema used by the UI.
    """
    bundle = (
        _load_content_bundle(
            text=text,
            url=url,
            file_bytes=file_bytes,
            file_name=file_name,
            file_path=file_path,
            ocr_options=ocr_options,
        )
        or {}
    )

    content = bundle.get("text") or ""
    extraction = bundle.get("extraction") or {}
    grounding_units = bundle.get("groundingUnits") or []

    tokens = _tokenize(content)

    if not tokens:
        (
            structured,
            structured_llm_used,
            structured_llm_model,
            governance,
            governance_llm_used,
            governance_llm_model,
        ) = _classify_structured_combined(
            content=content,
            file_name=file_name,
            tags=[],
            extraction=extraction,
            grounding_units=grounding_units,
            allow_llm=use_llm,
        )
        h = hashlib.sha256(content.encode("utf-8")).hexdigest()
        tag_details = _build_ai_tag_details(
            tags=[],
            structured=structured,
            signals=[],
            adv=[],
            phrases=[],
            unigrams=[],
            content=content,
            grounding_units=grounding_units,
        )
        smart_tags = _build_smart_tags(
            tags=[],
            tag_details=tag_details,
            structured=structured,
            content=content,
            grounding_units=grounding_units,
        )
        return {
            "tags": [],
            "tag_details": tag_details,
            "smart_tags": smart_tags,
            "phrases": [],
            "unigrams": [],
            "length": len(content),
            "hash": h,
            "tagger_version": TAGGER_VERSION,
            "structured": structured,
            "governance": governance,
            "extraction": extraction,
            "llm_used": False,
            "llm_model": None,
            "structured_llm_used": structured_llm_used,
            "structured_llm_model": structured_llm_model,
            "governance_llm_used": governance_llm_used,
            "governance_llm_model": governance_llm_model,
        }

    unigrams = _extract_unigrams(tokens, topk=200)
    phrases = _extract_phrases(tokens, topk=200)
    signals = _extract_signal_terms(content)

    adv: List[str] = []
    if generate_candidates is not None:
        try:
            adv = generate_candidates(content, topn=min(180, max(40, topk * 10)))  # type: ignore
        except Exception as e:
            log.debug("generate_candidates failed: %s", e)
            adv = []

    combined: List[str] = []
    for seq in (signals, adv, phrases, unigrams):
        for s in seq:
            if s and s not in combined:
                combined.append(s)

    tags = apply_taxonomy(combined)[:topk]

    llm_used = False
    llm_model: Optional[str] = None
    tagger_version = TAGGER_VERSION

    # World-class LLM rerank path:
    # Send rich deterministic candidates, not only phrases + unigrams.
    # This prevents the LLM from dropping rare but important signals.
    if use_llm:
        try:
            from reranker import has_llm_key, get_llm_model, rerank_with_llm  # type: ignore

            if has_llm_key():
                rich_candidates: List[Dict[str, Any]] = []
                seen_candidate_keys = set()

                def add_candidate_items(
                    items: Sequence[str],
                    *,
                    source: str,
                    confidence: float,
                    limit: int,
                    reason: str,
                ) -> None:
                    for item in list(items or [])[:limit]:
                        raw = _clean_text(item, 120)
                        if not raw:
                            continue

                        mapped = apply_taxonomy([raw])
                        value = mapped[0] if mapped else raw
                        if not value:
                            continue

                        key = str(value).casefold()
                        if key in seen_candidate_keys:
                            continue

                        seen_candidate_keys.add(key)
                        rich_candidates.append(
                            {
                                "value": value,
                                "source": source,
                                "confidence": confidence,
                                "reason": reason,
                            }
                        )

                # Filename can contain high-value identifiers that may not appear often in body text.
                if file_name:
                    filename_text = (
                        str(file_name)
                        .replace("_", " ")
                        .replace("-", " ")
                        .replace(".", " ")
                    )
                    filename_signals = _extract_signal_terms(filename_text, limit=500)
                    add_candidate_items(
                        filename_signals,
                        source="filename",
                        confidence=0.76,
                        limit=12,
                        reason="High-signal term found in the file name.",
                    )

                add_candidate_items(
                    signals,
                    source="signal",
                    confidence=0.82,
                    limit=80,
                    reason="High-signal deterministic term from acronym/entity/pattern extraction.",
                )

                add_candidate_items(
                    adv,
                    source="semantic_candidate",
                    confidence=0.74,
                    limit=120,
                    reason="Semantic/keyphrase candidate from advanced candidate generator.",
                )

                add_candidate_items(
                    phrases,
                    source="phrase_candidate",
                    confidence=0.62,
                    limit=120,
                    reason="Frequent phrase candidate from deterministic phrase extraction.",
                )

                add_candidate_items(
                    unigrams,
                    source="keyword_candidate",
                    confidence=0.55,
                    limit=120,
                    reason="Frequent keyword candidate from deterministic unigram extraction.",
                )

                llm_tags = rerank_with_llm(
                    rich_candidates,
                    topk=topk,
                    context_text=content,
                    file_name=file_name,
                    url=url,
                )
                llm_tags = apply_taxonomy(llm_tags)

                if llm_tags:
                    tags = llm_tags
                    llm_used = True
                    llm_model = get_llm_model()
                    tagger_version = f"{TAGGER_VERSION}+llm:{llm_model}"

        except Exception as e:
            log.warning("LLM rerank failed: %s", e)

    (
        structured,
        structured_llm_used,
        structured_llm_model,
        governance,
        governance_llm_used,
        governance_llm_model,
    ) = _classify_structured_combined(
        content=content,
        file_name=file_name,
        tags=list(tags),
        extraction=extraction,
        grounding_units=grounding_units,
        allow_llm=use_llm,
    )

    tag_details = _build_ai_tag_details(
        tags=tags,
        structured=structured,
        signals=signals,
        adv=adv,
        phrases=phrases,
        unigrams=unigrams,
        content=content,
        grounding_units=grounding_units,
    )
    smart_tags = _build_smart_tags(
        tags=tags,
        tag_details=tag_details,
        structured=structured,
        content=content,
        grounding_units=grounding_units,
    )

    # Canonical semantic hash for normalized extracted text.
    # This must stay distinct from the immutable binary SHA-256
    # recorded by the backend for the uploaded artifact itself.
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()

    return {
        "tags": tags,
        "tag_details": tag_details,
        "smart_tags": smart_tags,
        "phrases": phrases[:200],
        "unigrams": unigrams[:200],
        "length": len(content),
        "hash": h,
        "tagger_version": tagger_version,
        "llm_used": llm_used,
        "llm_model": llm_model,
        "structured": structured,
        "governance": governance,
        "extraction": extraction,
        "structured_llm_used": structured_llm_used,
        "structured_llm_model": structured_llm_model,
        "governance_llm_used": governance_llm_used,
        "governance_llm_model": governance_llm_model,
    }


__all__ = ["extract_and_tag_sync"]
