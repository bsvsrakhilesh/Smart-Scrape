# ai-tagger/extractors.py
from __future__ import annotations

import io
import os
from typing import Optional

import re

try:
    # trafilatura depends on lxml in practice; this lets us pre-clean HTML safely
    from lxml import html as lxml_html  # type: ignore
except Exception:  # pragma: no cover
    lxml_html = None  # type: ignore

import requests
import trafilatura
from pdfminer.high_level import extract_text as pdfminer_extract

# Toggle OCR with an env var if your images/PDFs need it
OCR_ENABLED = os.getenv("OCR_ENABLED", "false").lower() == "true"

# Remove common publisher chrome before extraction (nav/footer/live widgets/etc.)
_DROP_TAGS = {
    "script", "style", "noscript", "svg", "iframe",
    "header", "footer", "nav", "aside", "form", "button"
}

# Match class/id/aria/role hints that usually indicate chrome/ads/widgets
_DROP_HINT_RE = re.compile(
    r"(nav|menu|footer|header|subscribe|newsletter|sign[\s-]?in|login|cookie|consent|"
    r"share|social|follow|advert|ad-|ads|promo|banner|related|trending|recommended|"
    r"live|election|results)",
    flags=re.IGNORECASE,
)

# Candidate containers that often hold the main article body
_MAIN_XPATHS = [
    "//article",
    "//main",
    "//*[@role='main']",
    "//div[contains(@class,'article') or contains(@id,'article')]",
    "//div[contains(@class,'content') or contains(@id,'content')]",
]


def _strip_boilerplate_html(html: str) -> str:
    """
    Pre-clean HTML to reduce non-article text leaking into extraction.
    Safe fallback: if lxml isn't available, return original HTML unchanged.
    """
    if not html or lxml_html is None:
        return html

    try:
        tree = lxml_html.fromstring(html)

        # Drop obvious chrome tags
        for tag in _DROP_TAGS:
            for el in tree.xpath(f"//{tag}"):
                el.drop_tree()

        # Drop elements with chrome-like class/id/labels
        for el in list(tree.iter()):
            cls = el.get("class", "") or ""
            _id = el.get("id", "") or ""
            role = el.get("role", "") or ""
            aria = el.get("aria-label", "") or ""
            hay = " ".join([cls, _id, role, aria])
            if hay and _DROP_HINT_RE.search(hay):
                el.drop_tree()

        # Prefer a main container if it exists (article/main/etc.)
        best = None
        best_len = 0
        for xp in _MAIN_XPATHS:
            for node in tree.xpath(xp):
                txt = " ".join(node.itertext()).strip()
                L = len(txt)
                if L > best_len:
                    best_len = L
                    best = node

        if best is not None and best_len >= 400:
            tree = best

        result = lxml_html.tostring(tree, encoding="unicode", method="html")
        return result if isinstance(result, str) else str(result)
    except Exception:
        return html

# Heuristic boilerplate filters for common publisher chrome that can leak into
# extraction (e.g., "Election results", "Live", nav/footer blocks).
_NOISE_LINE_PATTERNS = [
    r"\belection\b",
    r"\blive\b",
    r"\blive updates\b",
    r"\bresults\b",
    r"\bsubscribe\b",
    r"\bprivacy policy\b",
    r"\bterms of use\b",
    r"\bnewsletter\b",
]
_NOISE_LINE_RE = re.compile("|".join(_NOISE_LINE_PATTERNS), flags=re.IGNORECASE)

def _cleanup_extracted_text(text: str) -> str:
    """Drop obvious boilerplate lines that still slip through extraction."""
    if not text:
        return ""

    out_lines = []
    seen = set()
    for raw in text.splitlines():
        line = (raw or "").strip()
        if not line:
            continue

        # Very short nav-ish fragments
        if len(line) <= 2:
            continue

        # Common publisher chrome / widgets
        if _NOISE_LINE_RE.search(line):
            continue

        # De-dupe repeated header/footer lines
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out_lines.append(line)

    return "\n".join(out_lines)

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
            # Local import to avoid top-level import errors if python-docx is absent
            try:
                from docx import Document  # lazy import
            except Exception:
                return ""
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
    
    html = _strip_boilerplate_html(html)
    # Try a precision-first extraction to reduce chrome leakage.
    txt = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
        deduplicate=True,
    )
    
    # Fallback: sometimes precision is too aggressive on certain publishers.
    if not txt or len(txt) < 250:
        txt = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=False,
            favor_recall=True,
            deduplicate=True,
        )
    
    return _cleanup_extracted_text(txt or "")

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
