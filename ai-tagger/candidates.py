# ai-tagger/candidates.py
"""
Candidate term generation for tagging/keyphrase extraction.

Exports:
- keybert_candidates(text, topn=12)         -> List[str]
- yake_candidates(text, topn=12)            -> List[str]
- spacy_chunks_and_ents(text, limit=6000)   -> Tuple[List[str], List[str]]
- generate_candidates(text, topn=20)        -> List[str]

Design goals:
- Graceful degradation if optional deps (spaCy/KeyBERT/YAKE) are unavailable.
- Lazy loading of heavy components.
- Type-safe under Pylance/MyPy.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple, Union, cast
import re

# ---------------------------
# Lazy singletons
# ---------------------------

_KW = None          # KeyBERT instance
_YAKE = None        # YAKE extractor
_NLP = None         # spaCy language model (en_core_web_sm)
_STOPWORDS = None   # stopword set (from spaCy if available, else fallback)


def _lazy_keybert():
    global _KW
    if _KW is not None:
        return _KW
    try:
        from keybert import KeyBERT  # type: ignore
        _KW = KeyBERT(model="sentence-transformers/all-MiniLM-L6-v2")
    except Exception:
        _KW = None
    return _KW


def _lazy_yake():
    global _YAKE
    if _YAKE is not None:
        return _YAKE
    try:
        import yake  # type: ignore
        _YAKE = yake.KeywordExtractor(lan="en", n=3, dedupLim=0.9, top=40)
    except Exception:
        _YAKE = None
    return _YAKE


def _lazy_spacy():
    global _NLP, _STOPWORDS
    if _NLP is not None:
        return _NLP
    try:
        import spacy  # type: ignore
        try:
            _NLP = spacy.load("en_core_web_sm", disable=["tagger", "parser", "lemmatizer"])
        except Exception:
            _NLP = None
        if _NLP is not None:
            _STOPWORDS = set(_NLP.Defaults.stop_words)
        else:
            _STOPWORDS = _fallback_stopwords()
    except Exception:
        _NLP = None
        _STOPWORDS = _fallback_stopwords()
    return _NLP


def _fallback_stopwords() -> set:
    return {
        "the","a","an","and","or","if","but","on","in","at","to","for","of","by",
        "with","is","are","was","were","be","been","being","this","that","these",
        "those","it","its","as","from","into","about","over","after","before","between",
        "your","their","our","my","we","you","they","he","she","them","us","i"
    }


# ---------------------------
# Helpers
# ---------------------------

_SPACES = re.compile(r"\s+")
_PUNCT_EDGES = re.compile(r"^[\s\-\–\—\:;,\.\(\)\[\]\{\}'\"/\\\|]+|[\s\-\–\—\:;,\.\(\)\[\]\{\}'\"/\\\|]+$")


def _normalize(text: str) -> str:
    t = _SPACES.sub(" ", (text or "")).strip()
    t = _PUNCT_EDGES.sub("", t)
    return t


def _valid_candidate(s: str) -> bool:
    if not s:
        return False
    if len(s) < 2:
        return False
    if all(ch.isdigit() for ch in s):
        return False
    alpha = sum(ch.isalpha() for ch in s)
    if alpha == 0:
        return False
    if len(s.split()) > 6:
        return False
    if " " not in s:
        sw = _STOPWORDS or _fallback_stopwords()
        if s.lower() in sw:
            return False
    return True


def _dedupe_keep_order(items: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for x in items:
        k = x.casefold()
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out


def _term_from_tuple_or_str(x: Union[str, Tuple[str, float]]) -> str:
    """Type guard: always return the textual term."""
    if isinstance(x, tuple):
        return str(x[0])
    return str(x)


# ---------------------------
# Public component functions
# ---------------------------

def keybert_candidates(text: str, topn: int = 12) -> List[str]:
    """
    Return top-n KeyBERT phrases. If KeyBERT or model is unavailable, returns [].
    """
    kb = _lazy_keybert()
    if kb is None or not text or not text.strip():
        return []
    try:
        # KeyBERT returns List[Tuple[str, float]]
        raw = cast(List[Tuple[str, float]], kb.extract_keywords(
            text[:20000],
            keyphrase_ngram_range=(1, 3),
            stop_words="english",
            use_maxsum=True,
            nr_candidates=min(50, max(20, topn * 4)),
            diversity=0.6,
            top_n=topn,
        ))
        terms = [_normalize(_term_from_tuple_or_str(p)) for p in raw]
        terms = [t for t in terms if _valid_candidate(t)]
        return terms
    except Exception:
        return []


def yake_candidates(text: str, topn: int = 12) -> List[str]:
    """
    Return top-n YAKE phrases. If YAKE not installed, returns [].
    """
    yk = _lazy_yake()
    if yk is None or not text or not text.strip():
        return []
    try:
        # YAKE returns List[Tuple[str, float]]
        raw = cast(List[Tuple[str, float]], yk.extract_keywords(text[:20000]))
        # sort by score asc (lower is better)
        raw.sort(key=lambda x: x[1])
        terms = [_normalize(_term_from_tuple_or_str(p)) for p in raw]
        terms = [t for t in terms if _valid_candidate(t)]
        return terms[:topn]
    except Exception:
        return []


def spacy_chunks_and_ents(text: str, limit: int = 6000) -> Tuple[List[str], List[str]]:
    """
    Return (noun_chunks, named_entities) from spaCy if available, else ([], []).
    """
    nlp = _lazy_spacy()
    if nlp is None or not text or not text.strip():
        return [], []
    try:
        doc = nlp(text[:limit])
        chunks = [
            _normalize(c.text)
            for c in doc.noun_chunks
            if 1 <= len(_SPACES.split(c.text.strip())) <= 4
        ]
        ents = [
            _normalize(e.text)
            for e in doc.ents
            if e.label_ in ("ORG", "PRODUCT", "GPE", "LOC", "PERSON", "WORK_OF_ART")
        ]
        chunks = [c for c in chunks if _valid_candidate(c)]
        ents = [e for e in ents if _valid_candidate(e)]
        return _dedupe_keep_order(chunks), _dedupe_keep_order(ents)
    except Exception:
        return [], []


# ---------------------------
# Unified candidate generator
# ---------------------------

def generate_candidates(text: str, topn: int = 20) -> List[str]:
    """
    Merge KeyBERT, YAKE, and spaCy-derived candidates, dedupe, and rank with a simple
    consensus heuristic (prefer terms proposed by multiple components and 1–3 grams).
    """
    if not text or not text.strip():
        return []

    kb = keybert_candidates(text, topn=topn)
    yk = yake_candidates(text, topn=max(10, topn))
    chunks, ents = spacy_chunks_and_ents(text, limit=8000)

    weight: Dict[str, float] = {}

    def bump(items: Iterable[str], w: float) -> None:
        for s in items:
            k = s.casefold()
            weight[k] = weight.get(k, 0.0) + w

    bump(kb, 2.0)      # KeyBERT strong signal
    bump(yk, 1.5)      # YAKE moderate
    bump(chunks, 1.0)  # noun chunks
    bump(ents, 1.5)    # named entities

    all_items = _dedupe_keep_order(kb + yk + chunks + ents)

    def ngram_len(s: str) -> int:
        return len(_SPACES.split(s))

    def final_score(s: str) -> float:
        base = weight.get(s.casefold(), 0.0)
        n = ngram_len(s)
        if n == 2:
            base += 0.15
        elif n == 3:
            base += 0.10
        elif n >= 5:
            base -= 0.10
        return base

    ranked = sorted(all_items, key=lambda s: (-final_score(s), ngram_len(s), s))
    return ranked[:topn]


__all__ = [
    "keybert_candidates",
    "yake_candidates",
    "spacy_chunks_and_ents",
    "generate_candidates",
]
