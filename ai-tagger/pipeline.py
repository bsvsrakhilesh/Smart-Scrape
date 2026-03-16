# ai-tagger/pipeline.py
"""
Synchronous extraction + lightweight tagging pipeline.

Exports:
- extract_and_tag_sync(...) -> dict
This file is intentionally self-contained (no heavy optional deps),
so it runs both in Celery workers and under Pylance without unresolved symbols.
"""
from __future__ import annotations

import hashlib, logging, os, re
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

# We'll lazy-import the extractor to avoid import/path issues in Celery forks.
extract_text = None  # will be set on first use

# Taxonomy is optional; try both absolute and relative, else noop.
try:
    from taxonomy import apply_taxonomy  # type: ignore
except Exception:  # pragma: no cover
    try:
        from .taxonomy import apply_taxonomy  # type: ignore
    except Exception:  # pragma: no cover
        def apply_taxonomy(tags: Sequence[str]) -> List[str]:
            # stable-dedupe noop
            return list(dict.fromkeys(tags))

log = logging.getLogger("pipeline")
TAGGER_VERSION = os.getenv("TAGGER_VERSION", "0.2.1")
# Optional advanced candidate generator (KeyBERT/YAKE/spaCy).
# Safe: if deps/models aren't available it simply won't be used.
try:
    from candidates import generate_candidates  # type: ignore
except Exception:  # pragma: no cover
    try:
        from .candidates import generate_candidates  # type: ignore
    except Exception:  # pragma: no cover
        generate_candidates = None  # type: ignore

# simple tokenizer (letters/digits/hyphen/+/underscore); no trailing dots
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-+/_]*")
_STOPWORDS = set("""
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
""".split())

# High-signal tokens/phrases that often appear only once but should still surface as tags:
# - Acronyms: DPCC, CPCB, IIT
# - Acronym + Word: IIT Bombay
# - Alphanum: PM10, PM2.5
# - Proper noun sequences: Delhi Pollution Control Committee
_ACRONYM_RE = re.compile(r"\b[A-Z]{2,10}\b")
_ACRONYM_WITH_WORD_RE = re.compile(r"\b([A-Z]{2,10})\s+([A-Z][a-z]{2,})\b")
_ALPHANUM_RE = re.compile(r"\b[A-Z]{1,6}\d+(?:\.\d+)?\b")
_TITLE_SEQ_RE = re.compile(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")


def _extract_signal_terms(text: str, limit: int = 60000) -> List[str]:
    """Extract rare-but-important terms in order of appearance; de-duped."""
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

    # Most specific first
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
    # demote numeric/ID-like forms
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

def _extract_entities(text: str) -> List[Tuple[str, str]]:
    """Uses spaCy if available; otherwise returns []."""
    try:
        import spacy  # type: ignore
        nlp = spacy.load("en_core_web_sm")
        doc = nlp(text[:200000])
        return [(ent.text, ent.label_) for ent in doc.ents]
    except Exception:
        return []

extract_content = None


def _load_content_bundle(*, text: Optional[str] = None, url: Optional[str] = None,
                         file_bytes: Optional[bytes] = None, file_name: Optional[str] = None,
                         file_path: Optional[str] = None) -> Dict[str, Any]:
    """Centralized loader using extractors.extract_content with a safe fallback."""
    global extract_text, extract_content
    try:
        if extract_text is None or extract_content is None:
            import importlib, sys, pathlib
            _THIS_DIR = pathlib.Path(__file__).parent.resolve()
            if str(_THIS_DIR) not in sys.path:
                sys.path.insert(0, str(_THIS_DIR))
            extractors = importlib.import_module("extractors")
            extract_text = getattr(extractors, "extract_text")
            extract_content = getattr(extractors, "extract_content")

        bundle = extract_content(
            text=text,
            url=url,
            file_bytes=file_bytes,
            file_name=file_name,
            file_path=file_path,
        ) or {}

        if isinstance(bundle, dict) and "text" in bundle:
            return bundle

        content = extract_text(
            text=text,
            url=url,
            file_bytes=file_bytes,
            file_name=file_name,
            file_path=file_path,
        ) or ""

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

def _pick_top_tags(phrases: Sequence[str], unigrams: Sequence[str], topk: int) -> List[str]:
    tags: List[str] = []
    for p in phrases:
        if p not in tags:
            tags.append(p)
        if len(tags) >= topk:
            break
    if len(tags) < topk:
        for u in unigrams:
            if u not in tags and all(u not in t for t in tags):
                tags.append(u)
            if len(tags) >= topk:
                break
    return tags[:topk]

def _normalize_ws(s: str) -> str:
    return " ".join((s or "").replace("…", " ").split()).strip().lower()


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

def _classify_structured_safe(
    content: str,
    file_name: Optional[str],
    tags: List[str],
):
    """
    Returns structured CAQM labels if policy_taxonomy is installed; else None.
    Safe in Celery workers (no hard import failures).
    """
    try:
        try:
            from policy_taxonomy import classify_structured  # type: ignore
        except Exception:
            from .policy_taxonomy import classify_structured  # type: ignore

        return classify_structured(content, file_name=file_name, tags=tags)
    except Exception:
        return None

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
    
def extract_and_tag_sync(*, text: Optional[str] = None, url: Optional[str] = None,
                         file_bytes: Optional[bytes] = None, file_name: Optional[str] = None,
                         file_path: Optional[str] = None, topk: int = 20, use_llm: bool = False
                         ) -> Dict[str, Any]:
    """
    Deterministic, dependency-light tagger with OCR-aware extraction grounding.
    Returns: { tags, phrases, unigrams, length, hash, tagger_version, structured, extraction }
    """
    bundle = _load_content_bundle(
        text=text,
        url=url,
        file_bytes=file_bytes,
        file_name=file_name,
        file_path=file_path,
    ) or {}

    content = bundle.get("text") or ""
    extraction = bundle.get("extraction") or {}
    grounding_units = bundle.get("groundingUnits") or []

    tokens = _tokenize(content)

    structured = _classify_structured_safe(content, file_name, [])
    structured = _ground_structured(structured, grounding_units)

    if not tokens:
        h = hashlib.md5(content.encode("utf-8")).hexdigest()
        return {
            "tags": [],
            "phrases": [],
            "unigrams": [],
            "length": len(content),
            "hash": h,
            "tagger_version": TAGGER_VERSION,
            "structured": structured,
            "extraction": extraction,
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

    structured = _classify_structured_safe(content, file_name, list(tags))
    structured = _ground_structured(structured, grounding_units)

    h = hashlib.md5(content.encode("utf-8")).hexdigest()
    return {
        "tags": tags,
        "phrases": phrases[:200],
        "unigrams": unigrams[:200],
        "length": len(content),
        "hash": h,
        "tagger_version": tagger_version,
        "llm_used": llm_used,
        "llm_model": llm_model,
        "structured": structured,
        "extraction": extraction,
    }

__all__ = ["extract_and_tag_sync"]
