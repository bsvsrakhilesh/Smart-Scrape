"""ai-tagger/policy_taxonomy.py

Structured (typed) tagging for policy/compliance documents.

Output schema (v1):
{
  "profile": "caqm",
  "version": 1,
  "docType": {"value": "direction"|..., "score": 0..1, "evidence": "..."},
  "labels": {
      "sectors": [{"value": "transport", "score": 0..1, "evidence": "..."}, ...],
      "agencies": [...],
      "geography": [...],
      "programs": [...],
      "pollutants": [...]
  },
  "grap": {"mentioned": bool, "stage": "I"|"II"|"III"|"IV"|null, "evidence": "..."},
  "entities": {
      "directionNumbers": ["..."] ,
      "orderNumbers": ["..."],
      "referenceNumbers": ["..."],
      "dates": ["..."]
  }
}
"""

from __future__ import annotations

import os
import re
import pathlib
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None  # type: ignore

_THIS_DIR = pathlib.Path(__file__).parent.resolve()

# ----------------------------
# Regex helpers
# ----------------------------
_WS = re.compile(r"\s+")

# Direction / Order identifiers (kept conservative to reduce false positives)
_RE_DIR_NO = re.compile(r"\bDirection\s*No\.?\s*[:\-]?\s*([A-Za-z0-9./()\-\]{4,})", re.IGNORECASE)
_RE_ORDER_NO = re.compile(r"\bOrder\s*No\.?\s*[:\-]?\s*([A-Za-z0-9./()\-\]{4,})", re.IGNORECASE)
_RE_REF_NO = re.compile(r"\b(?:F\.?\s*No\.?|Ref\.?\s*No\.?|File\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9./()\-\]{4,})", re.IGNORECASE)

# Dates: 12/02/2024, 12-02-2024
_RE_DATE_DMY = re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b")
# Dates: 12 February 2024
_RE_DATE_WORD = re.compile(
    r"\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b",
    re.IGNORECASE,
)

# GRAP stage
_RE_GRAP_STAGE = re.compile(r"\bStage\s*[-:]?\s*(I{1,3}|IV|1|2|3|4)\b", re.IGNORECASE)


def _clean_text_for_scan(text: str, limit: int = 140000) -> str:
    t = (text or "")[:limit]
    return _WS.sub(" ", t)


def _snippet(hay: str, start: int, end: int, window: int = 90) -> str:
    """Return a compact evidence snippet around a match span."""
    if not hay:
        return ""
    a = max(0, start - window)
    b = min(len(hay), end + window)
    s = hay[a:b]
    s = _WS.sub(" ", s).strip()
    if a > 0:
        s = "… " + s
    if b < len(hay):
        s = s + " …"
    return s


@dataclass
class Rule:
    label: str
    keywords: List[str]
    patterns: List[re.Pattern]


class PolicyTaxonomy:
    def __init__(self, data: Dict[str, Any]):
        self.profile = str(data.get("profile") or "caqm")
        self.version = int(data.get("version") or 1)
        self.categories: Dict[str, Dict[str, Rule]] = {}

        cats = data.get("categories") if isinstance(data, dict) else {}
        if not isinstance(cats, dict):
            cats = {}

        for cat_name, labels in cats.items():
            if not isinstance(labels, dict):
                continue
            out: Dict[str, Rule] = {}
            for label, spec in labels.items():
                if not isinstance(spec, dict):
                    spec = {}
                kws = [str(x).strip() for x in (spec.get("keywords") or []) if str(x).strip()]
                pats_raw = [str(x) for x in (spec.get("patterns") or []) if str(x)]
                pats = []
                for p in pats_raw:
                    try:
                        pats.append(re.compile(p, re.IGNORECASE))
                    except Exception:
                        pass
                out[str(label)] = Rule(label=str(label), keywords=[k.lower() for k in kws], patterns=pats)
            self.categories[str(cat_name)] = out

    def score_rule(self, rule: Rule, text: str) -> Tuple[float, Optional[Tuple[int, int]]]:
        """Return (score, best_span)"""
        if not text:
            return 0.0, None

        t = text
        t_low = t.lower()

        best_span: Optional[Tuple[int, int]] = None
        if rule.patterns:
            for pat in rule.patterns:
                m = pat.search(t)
                if m:
                    best_span = (m.start(), m.end())
                    return 1.0, best_span

        hits = 0
        best_idx = None
        for kw in rule.keywords:
            if not kw:
                continue
            i = t_low.find(kw)
            if i >= 0:
                hits += 1
                if best_idx is None or i < best_idx:
                    best_idx = i

        if hits <= 0:
            return 0.0, None

        score = 0.45 + 0.20 * min(2, hits - 1)
        if hits >= 3:
            score = 0.85

        if best_idx is not None:
            best_span = (best_idx, min(len(t), best_idx + max(6, len(rule.keywords[0]) if rule.keywords else 10)))

        return float(min(0.95, score)), best_span


_DEFAULT_TAX_PATH = _THIS_DIR / "taxonomies" / "caqm.yaml"


def load_policy_taxonomy(path: Optional[str] = None) -> PolicyTaxonomy:
    """Load a policy taxonomy YAML. Safe fallback if PyYAML is missing."""
    path = path or os.getenv("POLICY_TAXONOMY_PATH")
    p = pathlib.Path(path) if path else _DEFAULT_TAX_PATH

    if yaml is None or not p.exists():
        return PolicyTaxonomy({"profile": "caqm", "version": 1, "categories": {}})

    with open(p, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        data = {"profile": "caqm", "version": 1, "categories": {}}

    return PolicyTaxonomy(data)


_TAX = load_policy_taxonomy()


def _top1(cat: str, text: str) -> Optional[Dict[str, Any]]:
    rules = _TAX.categories.get(cat) or {}
    best = None
    best_score = 0.0
    best_span = None
    for r in rules.values():
        score, span = _TAX.score_rule(r, text)
        if score > best_score:
            best, best_score, best_span = r.label, score, span
    if not best or best_score <= 0:
        return None

    ev = _snippet(text, best_span[0], best_span[1]) if best_span else ""
    return {"value": best, "score": round(best_score, 3), "evidence": ev}


def _topk(cat: str, text: str, k: int = 6, threshold: float = 0.45) -> List[Dict[str, Any]]:
    rules = _TAX.categories.get(cat) or {}
    scored: List[Tuple[str, float, Optional[Tuple[int, int]]]] = []
    for r in rules.values():
        score, span = _TAX.score_rule(r, text)
        if score >= threshold:
            scored.append((r.label, score, span))

    scored.sort(key=lambda x: (-x[1], x[0]))

    out: List[Dict[str, Any]] = []
    for label, score, span in scored[:k]:
        out.append({
            "value": label,
            "score": round(float(score), 3),
            "evidence": _snippet(text, span[0], span[1]) if span else "",
        })
    return out


def _extract_entities(text: str) -> Dict[str, List[str]]:
    t = text or ""

    def uniq(seq: List[str]) -> List[str]:
        seen = set()
        out = []
        for x in seq:
            x = (x or "").strip()
            if not x:
                continue
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    direction_numbers = uniq([m.group(1) for m in _RE_DIR_NO.finditer(t)])
    order_numbers = uniq([m.group(1) for m in _RE_ORDER_NO.finditer(t)])
    ref_numbers = uniq([m.group(1) for m in _RE_REF_NO.finditer(t)])
    dates = uniq([m.group(1) for m in _RE_DATE_DMY.finditer(t)] + [m.group(1) for m in _RE_DATE_WORD.finditer(t)])

    return {
        "directionNumbers": direction_numbers,
        "orderNumbers": order_numbers,
        "referenceNumbers": ref_numbers,
        "dates": dates,
    }


def _extract_grap(text: str) -> Dict[str, Any]:
    t = text or ""
    t_low = t.lower()

    mentioned = "grap" in t_low or "graded response action plan" in t_low
    stage = None
    ev = ""

    m = _RE_GRAP_STAGE.search(t)
    if m:
        raw = m.group(1).upper()
        if raw in ("1", "2", "3", "4"):
            stage = {"1": "I", "2": "II", "3": "III", "4": "IV"}.get(raw)
        else:
            stage = raw
        ev = _snippet(t, m.start(), m.end())
        mentioned = True

    return {"mentioned": bool(mentioned), "stage": stage, "evidence": ev}


def classify_structured(
    text: str,
    *,
    file_name: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Return structured labels + entities for CAQM-ish documents."""
    cleaned = _clean_text_for_scan(text)

    if file_name:
        cleaned = f"{file_name}\n\n{cleaned}"

    doc_type = _top1("doc_type", cleaned) or {"value": None, "score": 0.0, "evidence": ""}

    labels = {
        "sectors": _topk("sector", cleaned, k=6, threshold=0.45),
        "agencies": _topk("agency", cleaned, k=8, threshold=0.45),
        "geography": _topk("geography", cleaned, k=6, threshold=0.45),
        "programs": _topk("program", cleaned, k=4, threshold=0.45),
        "pollutants": _topk("pollutant", cleaned, k=6, threshold=0.45),
    }

    grap = _extract_grap(cleaned)
    entities = _extract_entities(cleaned)

    if tags:
        low_tags = [str(t).lower() for t in (tags or [])]
        if not labels["pollutants"]:
            if any("pm2" in t or "pm2.5" in t for t in low_tags):
                labels["pollutants"].append({"value": "pm25", "score": 0.4, "evidence": "(from tags)"})
            if any("pm10" in t for t in low_tags):
                labels["pollutants"].append({"value": "pm10", "score": 0.4, "evidence": "(from tags)"})

    return {
        "profile": _TAX.profile,
        "version": _TAX.version,
        "docType": doc_type,
        "labels": labels,
        "grap": grap,
        "entities": entities,
    }


__all__ = ["load_policy_taxonomy", "classify_structured"]