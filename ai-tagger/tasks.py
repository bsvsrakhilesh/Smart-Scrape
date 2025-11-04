from __future__ import annotations

import base64
import logging
import os
import pathlib
import sys
import hashlib
from typing import Any, Dict, Optional
from inspect import signature

from celery import Celery
import redis, hashlib, os, json

# Ensure local module imports work in forked workers
_THIS_DIR = pathlib.Path(__file__).parent.resolve()
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

BROKER_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
BACKEND_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_r = redis.Redis.from_url(REDIS_URL)

# ---- New: task runtime controls (tunable via env) ----
JOB_SOFT_LIMIT = int(os.getenv("JOB_SOFT_LIMIT", "30"))     # seconds
JOB_HARD_LIMIT = int(os.getenv("JOB_HARD_LIMIT", "60"))     # seconds
JOB_MAX_RETRIES = int(os.getenv("JOB_MAX_RETRIES", "3"))
CACHE_TTL = int(os.getenv("TAGGER_CACHE_TTL", "86400"))     # seconds (24h)
CACHE_NAMESPACE = os.getenv("TAGGER_CACHE_NS", "tagger:v1")

CELERY = Celery("ai_tagger", broker=BROKER_URL, backend=BACKEND_URL)
log = logging.getLogger("ai_tagger.tasks")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def _call_with_supported(func, **kwargs):
    """Call func with only the kwargs it accepts; remap common synonyms."""
    try:
        params = set(signature(func).parameters.keys())
    except Exception:
        return func()

    if "topk" in kwargs and "topk" not in params and "top_k" in params:
        kwargs["top_k"] = kwargs.pop("topk")
    if "use_llm" in kwargs and "use_llm" not in params and "useLLM" in params:
        kwargs["useLLM"] = kwargs.pop("use_llm")
    if "file_bytes" in kwargs and "file_bytes" not in params:
        for alt in ("bytes", "content", "data"):
            if alt in params:
                kwargs[alt] = kwargs.pop("file_bytes")
                break
    if "file_name" in kwargs and "file_name" not in params:
        for alt in ("filename", "name"):
            if alt in params:
                kwargs[alt] = kwargs.pop("file_name")
                break

    supported = {k: v for k, v in kwargs.items() if k in params}
    return func(**supported)


# ---- New: stable idempotency key & Redis helpers ----
def _normalize_ws(s: Optional[str]) -> str:
    if not s:
        return ""
    return " ".join(s.split())

def _fingerprint_payload(payload: Dict[str, Any]) -> str:
    """
    Build a stable fingerprint for idempotency:
    - Includes input type + key inputs + topk/use_llm.
    - For 'file', uses base64 as-is (avoids big decode at this stage).
    """
    t = (payload.get("input_type") or "").strip()
    topk = str(payload.get("topk", ""))
    use_llm = str(payload.get("use_llm", ""))
    if t == "text":
        base = _normalize_ws(payload.get("text") or "")
    elif t == "url":
        base = (payload.get("url") or "").strip()
    elif t == "file":
        # b64 + file_name; if enormous, b64 is already a compact transfer form
        base = f"{payload.get('file_base64') or ''}|{payload.get('file_name') or ''}"
    else:
        # Fallback: bounded JSON dump
        base = json.dumps(payload, sort_keys=True)[:2048]

    raw = f"{t}|k={topk}|llm={use_llm}|{base}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _cache_key(fingerprint: str) -> str:
    return f"{CACHE_NAMESPACE}:{fingerprint}"

def _cache_get(fingerprint: str) -> Optional[Dict[str, Any]]:
    try:
        b = _r.get(_cache_key(fingerprint))
        if not b:
            return None
        # Explicitly cast and decode b to satisfy type requirements.
        b_value: bytes = b  # type: ignore
        return json.loads(b_value.decode("utf-8"))
    except Exception:
        return None

def _cache_set(fingerprint: str, data: Dict[str, Any], ttl: int = CACHE_TTL) -> None:
    try:
        _r.setex(_cache_key(fingerprint), ttl, json.dumps(data))
    except Exception:
        pass


@CELERY.task(
    name="process_job",
    soft_time_limit=JOB_SOFT_LIMIT,
    time_limit=JOB_HARD_LIMIT,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": JOB_MAX_RETRIES},
)
def process_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize inputs and run the (synchronous) pipeline.
    Now includes Redis-backed idempotency (content+params) with TTL.
    Returns a dict with keys like: tags, hash, tagger_version, phrases, unigrams.
    """
    try:
        # ---- New: idempotency check before work ----
        fp = _fingerprint_payload(payload)
        cached = _cache_get(fp)
        if cached:
            # Non-breaking: we don't alter the shape, but we can annotate if desired
            cached.setdefault("cached", True)
            log.info("idempotent_cache_hit", extra={"fingerprint": fp})
            return cached

        # Optional advanced pipeline
        try:
            from pipeline import extract_and_tag_sync as _extract_and_tag_sync
            use_pipeline = True
        except Exception:
            use_pipeline = False

        # Basic extractor fallback
        try:
            from extractors import extract_text
        except Exception:
            extract_text = None

        input_type = payload.get("input_type")
        topk = int(payload.get("topk", 10))
        use_llm = bool(payload.get("use_llm", True))

        if input_type == "text":
            text = payload.get("text") or ""
            if use_pipeline:
                out = _call_with_supported(_extract_and_tag_sync, text=text, topk=topk, use_llm=use_llm)
            else:
                out = _fallback_tag(text, version=os.getenv("TAGGER_VERSION", "0.1.0"))

        elif input_type == "url":
            url = payload.get("url") or ""
            if use_pipeline:
                out = _call_with_supported(_extract_and_tag_sync, url=url, topk=topk, use_llm=use_llm)
            else:
                if extract_text:
                    text = _call_with_supported(extract_text, url=url)  # type: ignore
                    out = _fallback_tag(text or "", version=os.getenv("TAGGER_VERSION", "0.1.0"))
                else:
                    out = _fallback_tag("", version=os.getenv("TAGGER_VERSION", "0.1.0"))

        elif input_type == "file":
            b64: Optional[str] = payload.get("file_base64")
            file_name: Optional[str] = payload.get("file_name")
            raw = base64.b64decode(b64) if b64 else b""
            if use_pipeline:
                out = _call_with_supported(
                    _extract_and_tag_sync,
                    file_bytes=raw, file_name=file_name, topk=topk, use_llm=use_llm
                )
            else:
                if extract_text:
                    text = _call_with_supported(extract_text, file_bytes=raw, file_name=file_name)  # type: ignore
                    out = _fallback_tag(text or "", version=os.getenv("TAGGER_VERSION", "0.1.0"))
                else:
                    out = _fallback_tag("", version=os.getenv("TAGGER_VERSION", "0.1.0"))

        else:
            raise ValueError(f"Unsupported input_type: {input_type}")

        # ---- New: save result in cache (idempotent) ----
        # Keep response shape as-is; we may annotate 'cached': False for tracing.
        out = dict(out) if isinstance(out, dict) else {"result": out}
        out.setdefault("cached", False)
        _cache_set(fp, out, CACHE_TTL)

        return out

    except Exception as e:
        log.exception("process_job failed")
        raise e


def _fallback_tag(text: str, version: str = "0.1.0") -> Dict[str, Any]:
    """Very light heuristic tagger if the heavy pipeline is unavailable."""
    import re
    from collections import Counter

    tokens = [t.lower() for t in re.findall(r"[A-Za-z][A-Za-z0-9_\-]+", text or "")]
    stop = {
        "the","a","an","and","or","but","is","are","to","of","in","on","for","with","by",
        "this","that","these","those","it","as","be","we","you","i","at","from","was","were"
    }
    tokens = [t for t in tokens if t not in stop and len(t) > 2]
    cnt = Counter(tokens)
    unigrams = [w for (w, _) in cnt.most_common(100)]

    bigrams = Counter([" ".join(p) for p in zip(tokens, tokens[1:])])
    phrases = [p for (p, _) in bigrams.most_common(100)]

    tags = (phrases[:10]) + [u for u in unigrams if u not in phrases][:10]

    content_hash = hashlib.md5((text or "").encode("utf-8")).hexdigest()
    return {
        "tags": tags,
        "hash": content_hash,
        "tagger_version": version,
        "phrases": phrases[:200],
        "unigrams": unigrams[:200],
        "length": len(text or ""),
    }
