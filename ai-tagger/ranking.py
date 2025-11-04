# ai-tagger/ranking.py
from typing import List, Tuple, Dict
import re
from collections import Counter
import math

def dedupe_ordered(words: List[str]) -> List[str]:
    seen, out = set(), []
    for w in words:
        t = re.sub(r"\s+", " ", w).strip()
        t0 = t.lower()
        if not t0: continue
        if t0 in seen: continue
        if any(t0 in s or s in t0 for s in seen): continue
        seen.add(t0); out.append(t)
    return out

def _tf_score(cands: List[str], text: str) -> Dict[str, float]:
    low = text.lower()
    cnt = Counter()
    for c in cands:
        cnt[c] = low.count(c.lower())
    # normalize
    m = max(cnt.values()) if cnt else 1
    return {k: v/m for k, v in cnt.items()}

def ensemble_rank(cands: List[str], text: str) -> List[Tuple[str, float]]:
    # lightweight: combine term freq and length prior
    tfs = _tf_score(cands, text)
    scored = []
    for c in cands:
        length_bonus = min(len(c)/20.0, 1.0)  # prefer compact phrases mildly
        s = 0.6 * tfs.get(c, 0.0) + 0.4 * length_bonus
        scored.append((c, s))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored

def apply_domain_boosts(scored: List[Tuple[str,float]], boosts: Dict[str, float]) -> List[Tuple[str,float]]:
    out = []
    for t, s in scored:
        mult = 1.0
        tl = t.lower()
        for k, v in boosts.items():
            if k in tl: mult *= v
        out.append((t, s * mult))
    out.sort(key=lambda x: x[1], reverse=True)
    return out

def _cosine(a: List[float], b: List[float]) -> float:
    num = sum(x*y for x,y in zip(a,b))
    da = math.sqrt(sum(x*x for x in a)) or 1e-9
    db = math.sqrt(sum(y*y for y in b)) or 1e-9
    return num/(da*db)

def mmr_diversify(scored: List[Tuple[str,float]], topk: int, diversity: float = 0.6) -> List[Tuple[str,float]]:
    # simple n-gram vector; cheap proxy
    vocab = {}
    def vec(s: str):
        toks = s.lower().split()
        grams = toks + [f"{a}_{b}" for a,b in zip(toks, toks[1:])]
        v = [0.0]*len(vocab)
        for g in grams:
            if g not in vocab: vocab[g] = len(vocab)
        v = [0.0]*len(vocab)
        for g in grams:
            v[vocab[g]] += 1.0
        return v

    selected: List[Tuple[str,float]] = []
    selected_vecs: List[List[float]] = []

    for t, s in scored:
        if len(selected) >= topk: break
        v = vec(t)
        if not selected:
            selected.append((t,s)); selected_vecs.append(v); continue
        sims = [ _cosine(v, sv) for sv in selected_vecs ]
        max_sim = max(sims) if sims else 0.0
        mmr = (1-diversity) * s - diversity * max_sim
        selected.append((t, mmr))
        selected_vecs.append(v)

    selected.sort(key=lambda x: x[1], reverse=True)
    return selected
