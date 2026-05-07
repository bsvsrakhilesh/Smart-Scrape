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
JOB_SOFT_LIMIT = int(os.getenv("JOB_SOFT_LIMIT", "30"))  # seconds
JOB_HARD_LIMIT = int(os.getenv("JOB_HARD_LIMIT", "60"))  # seconds
JOB_MAX_RETRIES = int(os.getenv("JOB_MAX_RETRIES", "3"))
CACHE_TTL = int(os.getenv("TAGGER_CACHE_TTL", "86400"))  # seconds (24h)
CACHE_NAMESPACE = os.getenv("TAGGER_CACHE_NS", "tagger:v2-smart-tags")

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


def _file_identity_from_path(file_path: Optional[str]) -> str:
    if not file_path:
        return ""

    try:
        p = pathlib.Path(file_path).resolve(strict=True)
        st = p.stat()
        return f"{p}|size={st.st_size}|mtime_ns={st.st_mtime_ns}"
    except Exception:
        return str(file_path)


def _cleanup_ingress_file(file_path: Optional[str]) -> None:
    if not file_path:
        return

    try:
        ingress_root = pathlib.Path(
            os.getenv("TAGGER_INGRESS_DIR", "/ingress")
        ).resolve(strict=False)
        target = pathlib.Path(file_path).resolve(strict=True)

        if target == ingress_root or ingress_root in target.parents:
            if target.exists():
                target.unlink()
    except Exception:
        pass


def _fingerprint_payload(payload: Dict[str, Any]) -> str:
    """
    Build a stable fingerprint for idempotency:
    - Includes input type + key inputs + topk/use_llm.
    - For 'file', uses base64 as-is (avoids big decode at this stage).
    """
    t = (payload.get("input_type") or "").strip()
    topk = str(payload.get("topk", ""))
    use_llm = str(payload.get("use_llm", ""))
    ocr_options = json.dumps(payload.get("ocr_options") or {}, sort_keys=True)
    if t == "text":
        base = _normalize_ws(payload.get("text") or "")
    elif t == "url":
        base = (payload.get("url") or "").strip()
    elif t == "file":
        if payload.get("file_path"):
            base = (
                f"{_file_identity_from_path(payload.get('file_path'))}"
                f"|{payload.get('file_name') or ''}"
            )
        else:
            base = (
                f"{payload.get('file_base64') or ''}|{payload.get('file_name') or ''}"
            )
    else:
        # Fallback: bounded JSON dump
        base = json.dumps(payload, sort_keys=True)[:2048]

    raw = f"{t}|k={topk}|llm={use_llm}|ocr={ocr_options}|{base}"
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


def _task_attempt(task: Any) -> int:
    try:
        return int(getattr(task.request, "retries", 0)) + 1
    except Exception:
        return 1


def _emit_progress(
    task: Any,
    stage: str,
    progress: int,
    message: str,
    **meta: Any,
) -> None:
    try:
        payload: Dict[str, Any] = {
            "stage": stage,
            "progress": max(0, min(100, int(progress))),
            "message": message,
            "attempt": _task_attempt(task),
            "tagger_version": os.getenv("TAGGER_VERSION", "0.1.0"),
        }
        payload.update(meta)
        task.update_state(state="STARTED", meta=payload)
    except Exception:
        pass


@CELERY.task(
    bind=True,
    name="process_job",
    soft_time_limit=JOB_SOFT_LIMIT,
    time_limit=JOB_HARD_LIMIT,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": JOB_MAX_RETRIES},
)
def process_job(self: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize inputs and run the (synchronous) pipeline.
    Now includes Redis-backed idempotency (content+params) with TTL.
    Returns a dict with keys like: tags, hash, tagger_version, phrases, unigrams.
    """
    try:
        _emit_progress(self, "cache_lookup", 4, "Checking idempotency cache")

        fp = _fingerprint_payload(payload)
        cached = _cache_get(fp)

        if cached:
            if (payload.get("input_type") == "url") and int(
                cached.get("length") or 0
            ) == 0:
                log.warning(
                    "idempotent_cache_empty_drop",
                    extra={"fingerprint": fp, "url": payload.get("url")},
                )
                try:
                    _r.delete(_cache_key(fp))
                except Exception:
                    pass
                cached = None
            else:
                cached["cached"] = True
                log.info("idempotent_cache_hit", extra={"fingerprint": fp})
                if payload.get("cleanup_file_after_read") and payload.get("file_path"):
                    _cleanup_ingress_file(payload.get("file_path"))
                return cached

        try:
            from pipeline import extract_and_tag_sync as _extract_and_tag_sync

            use_pipeline = True
        except Exception:
            use_pipeline = False

        try:
            from extractors import extract_text
        except Exception:
            extract_text = None

        input_type = payload.get("input_type")
        topk = int(payload.get("topk", 10))
        use_llm = bool(payload.get("use_llm", False))
        ocr_options = payload.get("ocr_options") or None

        _emit_progress(
            self,
            "input_normalized",
            12,
            "Input normalized for extraction",
            input_type=input_type,
            use_pipeline=use_pipeline,
            use_llm=use_llm,
            topk=topk,
        )

        if input_type == "text":
            text = payload.get("text") or ""
            _emit_progress(
                self,
                "extract_and_tag",
                48,
                "Running text extraction pipeline",
                input_type=input_type,
            )
            if use_pipeline:
                out = _call_with_supported(
                    _extract_and_tag_sync,
                    text=text,
                    topk=topk,
                    use_llm=use_llm,
                )
            else:
                out = _fallback_tag(text, version=os.getenv("TAGGER_VERSION", "0.1.0"))

        elif input_type == "url":
            url = payload.get("url") or ""
            _emit_progress(
                self,
                "extract_and_tag",
                48,
                "Running URL extraction pipeline",
                input_type=input_type,
                url=url,
            )
            if use_pipeline:
                out = _call_with_supported(
                    _extract_and_tag_sync,
                    url=url,
                    topk=topk,
                    use_llm=use_llm,
                    ocr_options=ocr_options,
                )
            else:
                if extract_text:
                    text = _call_with_supported(
                        extract_text,
                        url=url,
                        ocr_options=ocr_options,
                    )  # type: ignore
                    out = _fallback_tag(
                        text or "", version=os.getenv("TAGGER_VERSION", "0.1.0")
                    )
                else:
                    out = _fallback_tag(
                        "", version=os.getenv("TAGGER_VERSION", "0.1.0")
                    )

        elif input_type == "file":
            file_name: Optional[str] = payload.get("file_name")
            file_path: Optional[str] = payload.get("file_path")
            cleanup_file_after_read = bool(
                payload.get("cleanup_file_after_read", False)
            )

            raw = b""
            if not file_path:
                b64: Optional[str] = payload.get("file_base64")
                raw = base64.b64decode(b64) if b64 else b""

            _emit_progress(
                self,
                "extract_and_tag",
                48,
                "Running file extraction pipeline",
                input_type=input_type,
                file_name=file_name,
                file_path=file_path,
            )

            if use_pipeline:
                kwargs: Dict[str, Any] = {
                    "file_name": file_name,
                    "topk": topk,
                    "use_llm": use_llm,
                    "ocr_options": ocr_options,
                }
                if file_path:
                    kwargs["file_path"] = file_path
                else:
                    kwargs["file_bytes"] = raw

                out = _call_with_supported(_extract_and_tag_sync, **kwargs)
            else:
                if extract_text:
                    kwargs: Dict[str, Any] = {
                        "file_name": file_name,
                        "ocr_options": ocr_options,
                    }
                    if file_path:
                        kwargs["file_path"] = file_path
                    else:
                        kwargs["file_bytes"] = raw

                    text = _call_with_supported(extract_text, **kwargs)  # type: ignore
                    out = _fallback_tag(
                        text or "", version=os.getenv("TAGGER_VERSION", "0.1.0")
                    )
                else:
                    out = _fallback_tag(
                        "", version=os.getenv("TAGGER_VERSION", "0.1.0")
                    )

            if cleanup_file_after_read and file_path:
                _cleanup_ingress_file(file_path)

        _emit_progress(
            self,
            "finalizing",
            92,
            "Finalizing tag payload",
            input_type=input_type,
        )

        out = dict(out) if isinstance(out, dict) else {"result": out}
        out["cached"] = False

        cache_data = dict(out)
        cache_data.pop("cached", None)

        should_cache = True
        if input_type == "url" and int(out.get("length") or 0) == 0:
            should_cache = False
            log.warning(
                "skip_cache_empty_extraction",
                extra={"url": payload.get("url"), "fingerprint": fp},
            )

        if should_cache:
            _cache_set(fp, cache_data, CACHE_TTL)

        return out

    except Exception as e:
        try:
            self.update_state(
                state="FAILURE",
                meta={
                    "stage": "failed",
                    "progress": 100,
                    "message": "Tagger job failed",
                    "attempt": _task_attempt(self),
                    "error": str(e),
                    "tagger_version": os.getenv("TAGGER_VERSION", "0.1.0"),
                },
            )
        except Exception:
            pass

        log.exception("process_job failed")
        raise e


def _fallback_tag(text: str, version: str = "0.1.0") -> Dict[str, Any]:
    """Very light heuristic tagger if the heavy pipeline is unavailable."""
    import re
    from collections import Counter

    tokens = [t.lower() for t in re.findall(r"[A-Za-z][A-Za-z0-9_\-]+", text or "")]
    stop = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "is",
        "are",
        "to",
        "of",
        "in",
        "on",
        "for",
        "with",
        "by",
        "this",
        "that",
        "these",
        "those",
        "it",
        "as",
        "be",
        "we",
        "you",
        "i",
        "at",
        "from",
        "was",
        "were",
    }
    tokens = [t for t in tokens if t not in stop and len(t) > 2]
    cnt = Counter(tokens)
    unigrams = [w for (w, _) in cnt.most_common(100)]

    bigrams = Counter([" ".join(p) for p in zip(tokens, tokens[1:])])
    phrases = [p for (p, _) in bigrams.most_common(100)]

    tags = (phrases[:10]) + [u for u in unigrams if u not in phrases][:10]
    tag_details = [
        {
            "value": tag,
            "display": tag.replace("_", " "),
            "type": "keyword",
            "source": "fallback",
            "confidence": 0.4,
            "evidence": None,
            "locator": None,
            "rank": idx,
        }
        for idx, tag in enumerate(tags, start=1)
    ]

    content_hash = hashlib.md5((text or "").encode("utf-8")).hexdigest()
    return {
        "tags": tags,
        "tag_details": tag_details,
        "hash": content_hash,
        "tagger_version": version,
        "phrases": phrases[:200],
        "unigrams": unigrams[:200],
        "length": len(text or ""),
    }
