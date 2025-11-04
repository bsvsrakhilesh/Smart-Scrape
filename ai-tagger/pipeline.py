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
    raw_tags = _pick_top_tags(phrases, unigrams, topk=topk)
    tags     = apply_taxonomy(raw_tags)

    h = hashlib.md5(content.encode("utf-8")).hexdigest()
    return {"tags": tags, "phrases": phrases[:200], "unigrams": unigrams[:200],
            "length": len(content), "hash": h, "tagger_version": TAGGER_VERSION}

__all__ = ["extract_and_tag_sync"]
