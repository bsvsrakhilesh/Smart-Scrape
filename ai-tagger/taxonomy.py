# ai-tagger/taxonomy.py
"""
Canonicalize free-form tags using an optional YAML taxonomy.
Two accepted YAML shapes (use either):
1) synonyms:
     llm: ["large language model", "l.l.m", "large-language-model"]
     nlp: ["natural language processing", "nlp/ai"]
2) alias_to_canonical:
     "large language model": llm
     "natural language processing": nlp
If no file is provided, apply_taxonomy() just lowercases/normalizes and de-dupes.
"""

from __future__ import annotations
import os, re
from typing import Dict, Iterable, List

try:
    import yaml  # optional; only needed if you provide a YAML file
except Exception:  # pragma: no cover
    yaml = None  # type: ignore

# -------- Normalization helpers --------
_spc = re.compile(r"\s+")
_punct_edges = re.compile(r"^[\s\-\._/,:;|]+|[\s\-\._/,:;|]+$")

def _norm(s: str) -> str:
    s = s.lower().strip()
    s = _punct_edges.sub("", s)
    s = _spc.sub(" ", s)
    return s

# -------- Load taxonomy (optional) --------
_alias_to_canonical: Dict[str, str] = {}

def load_taxonomy(path: str | None = None) -> Dict[str, str]:
    """Return alias->canonical dict. Safe if file missing or PyYAML not installed."""
    global _alias_to_canonical
    if path is None:
        path = os.getenv("TAXONOMY_PATH")  # e.g., /app/taxonomy.yaml

    _alias_to_canonical = {}
    if not path or not os.path.exists(path) or yaml is None:
        return _alias_to_canonical

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    # shape 1: { synonyms: { canonical: [alias, ...] } }
    syns = data.get("synonyms") if isinstance(data, dict) else None
    if isinstance(syns, dict):
        for canonical, aliases in syns.items():
            can = _norm(str(canonical))
            _alias_to_canonical[can] = can
            if isinstance(aliases, (list, tuple)):
                for a in aliases:
                    _alias_to_canonical[_norm(str(a))] = can

    # shape 2: { alias_to_canonical: { alias: canonical } }
    a2c = data.get("alias_to_canonical") if isinstance(data, dict) else None
    if isinstance(a2c, dict):
        for alias, canonical in a2c.items():
            _alias_to_canonical[_norm(str(alias))] = _norm(str(canonical))

    return _alias_to_canonical

# eager-load if env var is set, else remain empty (noop mode)
if os.getenv("TAXONOMY_PATH"):
    load_taxonomy(os.getenv("TAXONOMY_PATH"))

# -------- Public API --------
def apply_taxonomy(tags: Iterable[str]) -> List[str]:
    """
    Map free-form tags to canonical forms using the loaded taxonomy.
    - Always normalize (lowercase, trim, collapse spaces)
    - If alias exists -> replace with canonical
    - Stable de-duplication (order preserved)
    """
    out: List[str] = []
    seen = set()
    for t in tags or []:
        n = _norm(str(t))
        n = _alias_to_canonical.get(n, n)  # map alias -> canonical if known
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out

__all__ = ["load_taxonomy", "apply_taxonomy"]
