from __future__ import annotations

import base64
import logging
import os
import pathlib
import shutil
import uuid
from typing import Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from tasks import CELERY, process_job  # celery app + task

log = logging.getLogger("ai_tagger")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(
    title="SmartScrape AI Tagger", version=os.getenv("TAGGER_VERSION", "0.1.0")
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobAccepted(BaseModel):
    jobId: str = Field(..., description="Celery task id")
    job_id: Optional[str] = Field(None, description="Alias for compatibility")


@app.get("/ping")
def ping() -> Dict[str, Any]:
    return {"ok": True, "version": app.version}


@app.get("/health")
def health() -> Dict[str, Any]:
    worker_names = _celery_worker_names()
    worker_count = len(worker_names)

    return {
        "ok": True,
        "ready": worker_count > 0,
        "version": app.version,
        "queue": {
            "workers": worker_count,
            "worker_names": worker_names,
        },
    }


def _normalize_bool(val: Optional[str], default=True) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")


def _safe_file_name(name: Optional[str]) -> str:
    candidate = pathlib.Path(str(name or "upload.bin")).name.strip()
    return candidate or "upload.bin"


def _shared_file_roots() -> list[pathlib.Path]:
    raw = os.getenv("TAGGER_SHARED_FILE_ROOTS", "/data,/ingress")
    roots: list[pathlib.Path] = []

    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        roots.append(pathlib.Path(part).expanduser())

    return roots


def _resolve_allowed_file_path(candidate: str) -> Optional[str]:
    if not candidate:
        return None

    try:
        resolved = pathlib.Path(candidate).expanduser().resolve(strict=True)
    except Exception:
        return None

    for root in _shared_file_roots():
        try:
            resolved_root = root.expanduser().resolve(strict=False)
        except Exception:
            continue

        if resolved == resolved_root or resolved_root in resolved.parents:
            return str(resolved)

    return None


def _ingress_dir() -> pathlib.Path:
    root = pathlib.Path(os.getenv("TAGGER_INGRESS_DIR", "/ingress")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _persist_upload_to_ingress(upload: UploadFile) -> tuple[str, str]:
    file_name = _safe_file_name(upload.filename)
    suffix = pathlib.Path(file_name).suffix
    target = _ingress_dir() / f"{uuid.uuid4().hex}{suffix}"

    upload.file.seek(0)
    with target.open("wb") as f:
        shutil.copyfileobj(upload.file, f)

    return str(target), file_name


def _persist_base64_to_ingress(
    file_base64: str, file_name: Optional[str]
) -> Optional[tuple[str, str]]:
    try:
        raw = base64.b64decode(file_base64)
    except Exception:
        return None

    if not raw:
        return None

    safe_name = _safe_file_name(file_name)
    suffix = pathlib.Path(safe_name).suffix
    target = _ingress_dir() / f"{uuid.uuid4().hex}{suffix}"
    target.write_bytes(raw)

    return str(target), safe_name


def _celery_worker_stats() -> Dict[str, Any]:
    """
    Returns Celery worker stats if at least one worker is reachable.
    Empty dict means: no worker reachable (or broker/inspect unavailable).
    """
    try:
        inspector = CELERY.control.inspect(timeout=1.5)
        stats = inspector.stats() or {}
        return stats if isinstance(stats, dict) else {}
    except Exception as e:
        log.warning("Failed to inspect Celery workers: %s", e)
        return {}


def _celery_worker_names() -> list[str]:
    stats = _celery_worker_stats()
    return sorted(stats.keys())


def _celery_worker_count() -> int:
    return len(_celery_worker_names())


@app.post("/jobs", response_model=JobAccepted)
async def create_job(
    request: Request,
    # simple form fields
    url: Optional[str] = Form(None),
    text: Optional[str] = Form(None),
    file_base64: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None),
    file_path: Optional[str] = Form(None),
    # best-effort direct capture when field is exactly "file"
    file: Optional[UploadFile] = File(None),
    # knobs
    topk: Optional[int] = Form(20),
    use_llm: Optional[str] = Form("true"),
):
    """
    Accepts any of: url, text, file_path, file_base64, or a file upload
    (under any field name). Large files are queued by shared path, not inline base64.
    """
    use_llm_bool = _normalize_bool(use_llm, default=True)
    topk = int(topk) if topk is not None else 20

    worker_count = _celery_worker_count()
    if worker_count == 0:
        return JSONResponse(
            status_code=503,
            content={
                "detail": "No ai-tagger workers are available. Start at least one Celery worker before creating jobs.",
                "code": "NO_TAGGER_WORKERS",
            },
        )

    # If standard field "file" arrived, use it; else scan form for ANY UploadFile
    upload: Optional[UploadFile] = file
    if upload is None:
        try:
            form = await request.form()
            for key, value in form.multi_items():
                if isinstance(value, UploadFile):
                    upload = value
                    log.info(
                        "Received upload field '%s' filename='%s' content_type='%s'",
                        key,
                        value.filename,
                        value.content_type,
                    )
                    break
        except Exception as e:
            log.warning("Failed to parse multipart form: %s", e)

    payload: Dict[str, Any] = {"topk": topk, "use_llm": use_llm_bool}

    if text:
        payload.update({"input_type": "text", "text": text})
    elif url:
        payload.update({"input_type": "url", "url": url})
    elif file_path:
        resolved = _resolve_allowed_file_path(file_path)
        if not resolved:
            return JSONResponse(
                status_code=400,
                content={
                    "detail": "file_path must exist under TAGGER_SHARED_FILE_ROOTS",
                    "code": "INVALID_FILE_PATH",
                },
            )

        payload.update(
            {
                "input_type": "file",
                "file_path": resolved,
                "file_name": _safe_file_name(file_name or pathlib.Path(resolved).name),
            }
        )
    elif file_base64:
        persisted = _persist_base64_to_ingress(file_base64, file_name)
        if not persisted:
            return JSONResponse(
                status_code=400,
                content={"detail": "file_base64 is invalid or empty"},
            )

        persisted_path, persisted_name = persisted
        payload.update(
            {
                "input_type": "file",
                "file_path": persisted_path,
                "file_name": persisted_name,
                "cleanup_file_after_read": True,
            }
        )
    elif upload is not None:
        try:
            persisted_path, persisted_name = _persist_upload_to_ingress(upload)
        except Exception as e:
            log.exception("Failed to persist upload to ingress")
            return JSONResponse(
                status_code=500,
                content={"detail": f"Failed to persist uploaded file: {e}"},
            )

        payload.update(
            {
                "input_type": "file",
                "file_path": persisted_path,
                "file_name": persisted_name,
                "cleanup_file_after_read": True,
            }
        )
    else:
        return JSONResponse(
            status_code=400,
            content={
                "detail": "Provide url, text, file_path, file upload, or file_base64"
            },
        )

    # Dispatch Celery job
    async_result = process_job.delay(payload)
    job_id = async_result.id
    return JobAccepted(jobId=job_id, job_id=job_id)


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    """
    - PENDING/STARTED/RETRY -> 202
    - SUCCESS -> 200 with flattened result payload
    - FAILURE -> 500 with error
    """
    async_result = CELERY.AsyncResult(job_id)
    state = async_result.state
    meta = async_result.info if isinstance(async_result.info, dict) else {}

    if state in ("PENDING", "STARTED", "RETRY"):
        progress = meta.get("progress")
        return JSONResponse(
            status_code=202,
            content={
                "state": state,
                "progress": int(progress) if isinstance(progress, (int, float)) else 0,
                "stage": meta.get("stage"),
                "message": meta.get("message"),
                "attempt": meta.get("attempt"),
                "tagger_version": meta.get("tagger_version"),
                "cached": meta.get("cached"),
            },
        )

    if state == "SUCCESS":
        result = async_result.result or {}
        if isinstance(result, dict):
            return {"state": "SUCCESS", **result}
        return {"state": "SUCCESS", "result": result}

    err = str(meta.get("error") or async_result.info or "unknown error")
    return JSONResponse(
        status_code=500,
        content={
            "state": state,
            "error": err,
            "stage": meta.get("stage"),
            "message": meta.get("message"),
            "attempt": meta.get("attempt"),
            "progress": meta.get("progress"),
            "tagger_version": meta.get("tagger_version"),
        },
    )


@app.middleware("http")
async def request_id_ctx(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or request.headers.get("X-Request-Id")
    response = await call_next(request)
    if rid:
        response.headers["X-Request-ID"] = rid
    return response
