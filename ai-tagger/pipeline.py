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
TAGGER_VERSION = os.getenv("TAGGER_VERSION", "0.4.0")

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
        "construction_demolition": "C&D",
        "waste_burning": "Waste burning",
        "biomass_burning": "Biomass burning",
        "industry_power": "Industry & power",
        "dg_sets": "DG sets",
        "office_memorandum": "Office memorandum",
        "sop_guideline": "SOP / Guideline",
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


def extract_and_tag_sync(
    *,
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
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
        return {
            "tags": [],
            "tag_details": tag_details,
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

    # Existing tag rerank path (optional)
    if use_llm:
        try:
            from reranker import has_llm_key, get_llm_model, rerank_with_llm  # type: ignore

            if has_llm_key():
                candidates = list(phrases[:120]) + list(unigrams[:120])
                llm_tags = rerank_with_llm(candidates, topk=topk, context_text=content)
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

    # Canonical semantic hash for normalized extracted text.
    # This must stay distinct from the immutable binary SHA-256
    # recorded by the backend for the uploaded artifact itself.
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()

    return {
        "tags": tags,
        "tag_details": tag_details,
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
