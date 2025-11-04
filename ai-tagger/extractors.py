# ai-tagger/extractors.py
"""
Lightweight content extraction helpers used by the pipeline.

We expose three compatibility functions expected elsewhere:
- from_text(text)           -> str
- from_url(url)             -> str
- from_file(file_bytes, file_name=None) -> str

Internally we also support PDF/DOCX and optional OCR fallback.
"""

from __future__ import annotations

import io
import os
from typing import Optional

import requests
import trafilatura
from docx import Document
from pdfminer.high_level import extract_text as pdfminer_extract

# Toggle OCR with an env var if your images/PDFs need it
OCR_ENABLED = os.getenv("OCR_ENABLED", "false").lower() == "true"


# ---------------------------
# Primitive extractors
# ---------------------------
def _from_pdf_bytes(data: bytes) -> str:
    """Extract text from PDF bytes via pdfminer.six; optional OCR fallback."""
    try:
        return pdfminer_extract(io.BytesIO(data)) or ""
    except Exception:
        if OCR_ENABLED:
            try:
                from pdf2image import convert_from_bytes  # lazy import
                import pytesseract  # lazy import

                pages = convert_from_bytes(data, dpi=200)
                txt = [pytesseract.image_to_string(im) for im in pages]
                return "\n".join(txt)
            except Exception:
                return ""
        return ""


def _from_docx_bytes(data: bytes) -> str:
    """Extract text from DOCX bytes."""
    try:
        with io.BytesIO(data) as bio:
            doc = Document(bio)
            return "\n".join(p.text for p in doc.paragraphs)
    except Exception:
        return ""


# ---------------------------
# Public API (compatibility)
# ---------------------------
def from_text(text: Optional[str]) -> str:
    """Pass-through for raw text input (compatibility function)."""
    return text or ""


def from_url(url: str) -> str:
    """
    Fetch a URL with requests (so we control timeout/headers) and run Trafilatura
    extraction on the retrieved HTML. This avoids trafilatura.fetch_url(..., timeout=...),
    which is not supported in some installed versions.
    """
    resp = requests.get(
        url,
        timeout=15,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SmartScrapeBot/1.0)"},
    )
    resp.raise_for_status()
    html = resp.text or ""
    if not html:
        return ""
    return trafilatura.extract(html, include_comments=False, include_tables=False) or ""


def from_file(file_bytes: bytes, file_name: Optional[str] = None) -> str:
    """
    Extract text from uploaded file bytes. Uses file extension if provided.
    Falls back to UTF-8 decode when type is unknown.
    """
    name = (file_name or "").lower()
    if name.endswith(".pdf"):
        return _from_pdf_bytes(file_bytes)
    if name.endswith(".docx"):
        return _from_docx_bytes(file_bytes)

    # Try naive UTF-8 decode as a fallback (covers .txt/.md/.csv etc.)
    try:
        return file_bytes.decode("utf-8", "ignore")
    except Exception:
        return ""


# Convenience for file path (not part of the original public API, but useful)
def from_path(file_path: str) -> str:
    """Read a file from disk and route to from_file based on its extension."""
    if not os.path.exists(file_path):
        return ""
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        return from_file(data, file_name=file_path)
    except Exception:
        return ""


# Unified extractor (optional helper some code paths may prefer)
def extract_text(
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
) -> str:
    """
    One-shot extractor that supports multiple inputs. Keeps behavior consistent with the
    compatibility functions above but in a single call-site.
    """
    if text:
        return from_text(text)
    if url:
        try:
            return from_url(url)
        except Exception:
            return ""
    if file_bytes is not None:
        return from_file(file_bytes, file_name=file_name)
    if file_path:
        return from_path(file_path)
    return ""
