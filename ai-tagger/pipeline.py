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

def _load_content(*, text: Optional[str] = None, url: Optional[str] = None,
                  file_bytes: Optional[bytes] = None, file_name: Optional[str] = None,
                  file_path: Optional[str] = None) -> str:
    """Centralized loader using our extractors.extract_text helper."""
    global extract_text
    try:
        if extract_text is None:
            import importlib, sys, pathlib
            _THIS_DIR = pathlib.Path(__file__).parent.resolve()
            if str(_THIS_DIR) not in sys.path:
                sys.path.insert(0, str(_THIS_DIR))
            extractors = importlib.import_module('extractors')
            extract_text = getattr(extractors, 'extract_text')
        return extract_text(text=text, url=url, file_bytes=file_bytes,
                            file_name=file_name, file_path=file_path) or ""
    except Exception as e:
        # If optional deps (e.g., trafilatura) aren’t installed, fall back gracefully.
        log.warning("extract_text failed: %s", e)
        return text or ""

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

def extract_and_tag_sync(*, text: Optional[str] = None, url: Optional[str] = None,
                         file_bytes: Optional[bytes] = None, file_name: Optional[str] = None,
                         file_path: Optional[str] = None, topk: int = 20, use_llm: bool = False
                         ) -> Dict[str, Any]:
    """
    Deterministic, dependency-light tagger (signature kept compatible with Celery task).
    Returns: { tags, phrases, unigrams, length, hash, tagger_version }
    """
    content = _load_content(text=text, url=url, file_bytes=file_bytes,
                            file_name=file_name, file_path=file_path) or ""
    tokens = _tokenize(content)
    if not tokens:
        h = hashlib.md5(content.encode("utf-8")).hexdigest()
        return {"tags": [], "phrases": [], "unigrams": [], "length": len(content), "hash": h,
                "tagger_version": TAGGER_VERSION}

    unigrams = _extract_unigrams(tokens, topk=200)
    phrases  = _extract_phrases(tokens, topk=200)

    # NEW: rare-but-important signal terms (DPCC/CPCB/PM10/IIT Bombay/etc.)
    signals = _extract_signal_terms(content)

    # NEW: semantic/keyword candidates (KeyBERT/YAKE/spaCy) when available
    adv: List[str] = []
    if generate_candidates is not None:
        try:
            adv = generate_candidates(content, topn=min(180, max(40, topk * 10)))  # type: ignore
        except Exception as e:
            log.debug("generate_candidates failed: %s", e)
            adv = []

    # Combine sources in priority order; stable de-dupe
    combined: List[str] = []
    combined = []
    for seq in (signals, adv, phrases, unigrams):
        for s in seq:
            if s and s not in combined:
                combined.append(s)

    # Apply taxonomy normalization and take top-k
    tags = apply_taxonomy(combined)[:topk]
    raw_tags = combined[: max(60, topk * 8)]

    llm_used = False
    llm_model: Optional[str] = None
    tagger_version = TAGGER_VERSION

    # Optional: rerank tags with an LLM (OpenAI/OpenRouter) when enabled.
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

    h = hashlib.md5(content.encode("utf-8")).hexdigest()
    return {"tags": tags, "phrases": phrases[:200], "unigrams": unigrams[:200],
            "length": len(content), "hash": h, "tagger_version": tagger_version,
            "llm_used": llm_used, "llm_model": llm_model}

__all__ = ["extract_and_tag_sync"]
