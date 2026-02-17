# ai-tagger/extractors.py
from __future__ import annotations

import io
import os
from typing import Optional

import re
import json

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

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

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

def _jsonld_fallback(html: str) -> str:
    """
    Many publishers render the page with JS but still embed usable content in JSON-LD.
    We try to extract articleBody/description/headline from <script type="application/ld+json"> blocks.
    """
    if not html:
        return ""

    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )

    chunks = []
    for raw in scripts:
        raw = (raw or "").strip()
        if not raw:
            continue

        # Some sites include multiple JSON objects or invalid trailing commas.
        # Try a couple of normalizations.
        candidates = [raw]
        candidates.append(raw.replace("\n", " ").strip())

        obj = None
        for c in candidates:
            try:
                obj = json.loads(c)
                break
            except Exception:
                obj = None

        if obj is None:
            continue

        def walk(x):
            if isinstance(x, dict):
                yield x
                for v in x.values():
                    yield from walk(v)
            elif isinstance(x, list):
                for it in x:
                    yield from walk(it)

        for d in walk(obj):
            # Common fields for articles
            for k in ("articleBody", "description", "headline", "name"):
                v = d.get(k)
                if isinstance(v, str) and len(v.strip()) >= 80:
                    chunks.append(v.strip())

    # de-dupe while preserving order
    seen = set()
    out = []
    for c in chunks:
        if c not in seen:
            seen.add(c)
            out.append(c)

    return "\n\n".join(out).strip()

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
    Fetch a URL and extract text.
    - If the response is a PDF (by header, URL hint, or magic bytes), run pdfminer.
    - Otherwise treat as HTML and use trafilatura (+ JSON-LD fallback).
    """
    resp = requests.get(
        url,
        timeout=(10, 60),
        headers=_DEFAULT_HEADERS,
        allow_redirects=True,
    )
    resp.raise_for_status()

    ctype = (resp.headers.get("content-type") or "").lower()
    data = resp.content or b""

    # --- PDF detection (gov sites often mislabel content-type) ---
    url_l = (url or "").lower()
    looks_like_pdf_url = (
        url_l.endswith(".pdf")
        or ".pdf&" in url_l
        or ".pdf?" in url_l
        or "filename=" in url_l and ".pdf" in url_l
    )

    is_pdf_header = ("application/pdf" in ctype) or ("application/octet-stream" in ctype and looks_like_pdf_url)
    is_pdf_magic = len(data) >= 5 and data[:5] == b"%PDF-"

    if is_pdf_header or is_pdf_magic or looks_like_pdf_url:
        # If it isn't actually a PDF, magic bytes check will likely fail and pdfminer returns ""
        txt = _from_pdf_bytes(data)
        return _cleanup_extracted_text(txt or "")

    # --- HTML path ---
    html = resp.text or ""
    if not html:
        return ""

    orig_html = html
    cleaned = _strip_boilerplate_html(html)

    if cleaned and len(cleaned) >= int(0.35 * len(orig_html)):
        html = cleaned
    else:
        html = orig_html

    txt = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
        deduplicate=True,
    )

    if not txt or len(txt) < 250:
        txt = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=False,
            favor_recall=True,
            deduplicate=True,
        )

    if not txt or len(txt) < 250:
        jsonld_txt = _jsonld_fallback(orig_html)
        if jsonld_txt:
            txt = jsonld_txt

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
