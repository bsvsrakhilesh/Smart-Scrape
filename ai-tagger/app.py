from __future__ import annotations

import base64
import logging
import os
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
    return {"ok": True, "version": app.version}


def _normalize_bool(val: Optional[str], default=True) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")


@app.post("/jobs", response_model=JobAccepted)
async def create_job(
    request: Request,
    # simple form fields
    url: Optional[str] = Form(None),
    text: Optional[str] = Form(None),
    file_base64: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None),
    # best-effort direct capture when field is exactly "file"
    file: Optional[UploadFile] = File(None),
    # knobs
    topk: Optional[int] = Form(20),
    use_llm: Optional[str] = Form("false"),
):
    """
    Accepts any of: url, text, file_base64, or a file upload (under any field name).
    """
    use_llm_bool = _normalize_bool(use_llm, default=True)
    topk = int(topk) if topk is not None else 20

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
    elif file_base64:
        payload.update(
            {
                "input_type": "file",
                "file_base64": file_base64,
                "file_name": file_name,
            }
        )
    elif upload is not None:
        raw = await upload.read()
        if not raw:
            return JSONResponse(
                status_code=400, content={"detail": "Uploaded file is empty"}
            )
        b64 = base64.b64encode(raw).decode("utf-8")
        payload.update(
            {"input_type": "file", "file_base64": b64, "file_name": upload.filename}
        )
    else:
        return JSONResponse(
            status_code=400, content={"detail": "Provide url, text, or file_base64"}
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
