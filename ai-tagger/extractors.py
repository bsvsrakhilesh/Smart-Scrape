from __future__ import annotations

import io
import os
from typing import Optional, Dict, Any, List

import re
import json

try:
    from lxml import html as lxml_html  # type: ignore
except Exception:
    lxml_html = None  # type: ignore

import requests
import trafilatura
from pdfminer.high_level import extract_text as pdfminer_extract

OCR_ENABLED = os.getenv("OCR_ENABLED", "false").lower() == "true"
OCR_LANGS = os.getenv("OCR_LANGS", "eng")
OCR_PDF_DPI = int(os.getenv("OCR_PDF_DPI", "200"))
OCR_MAX_PAGES = max(1, int(os.getenv("OCR_MAX_PAGES", "20")))
OCR_PDF_MIN_CHARS = max(0, int(os.getenv("OCR_PDF_MIN_CHARS", "120")))
OCR_IMAGE_MAX_SIDE = max(640, int(os.getenv("OCR_IMAGE_MAX_SIDE", "2200")))
OCR_IMAGE_MIN_CHARS = max(0, int(os.getenv("OCR_IMAGE_MIN_CHARS", "20")))

URL_CONNECT_TIMEOUT = float(os.getenv("URL_CONNECT_TIMEOUT", "8"))
URL_READ_TIMEOUT = float(os.getenv("URL_READ_TIMEOUT", "20"))

_DROP_TAGS = {
    "script",
    "style",
    "noscript",
    "svg",
    "iframe",
    "header",
    "footer",
    "nav",
    "aside",
    "form",
    "button",
}

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

_MAIN_XPATHS = [
    "//article",
    "//main",
    "//*[@role='main']",
    "//div[contains(@class,'article') or contains(@id,'article')]",
    "//div[contains(@class,'content') or contains(@id,'content')]",
]


def _strip_boilerplate_html(html: str) -> str:
    if not html or lxml_html is None:
        return html
    try:
        tree = lxml_html.fromstring(html)
        for tag in _DROP_TAGS:
            for el in tree.xpath(f"//{tag}"):
                el.drop_tree()
        for el in list(tree.iter()):
            cls = el.get("class", "") or ""
            _id = el.get("id", "") or ""
            role = el.get("role", "") or ""
            aria = el.get("aria-label", "") or ""
            hay = " ".join([cls, _id, role, aria])
            if hay and _DROP_HINT_RE.search(hay):
                el.drop_tree()
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
        obj = None
        for c in [raw, raw.replace("\n", " ").strip()]:
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
            for k in ("articleBody", "description", "headline", "name"):
                v = d.get(k)
                if isinstance(v, str) and len(v.strip()) >= 80:
                    chunks.append(v.strip())

    seen = set()
    out = []
    for c in chunks:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return "\n\n".join(out).strip()


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
    if not text:
        return ""
    out_lines = []
    seen = set()
    for raw in text.splitlines():
        line = (raw or "").strip()
        if not line:
            continue
        if len(line) <= 2:
            continue
        if _NOISE_LINE_RE.search(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out_lines.append(line)
    return "\n".join(out_lines)


def _normalize_text(text: str) -> str:
    return _cleanup_extracted_text((text or "").replace("\x00", "").strip())


def _locator(**kwargs: Any) -> Dict[str, Any]:
    return {k: v for k, v in kwargs.items() if v is not None}


def _unit(
    text: str,
    locator: Dict[str, Any],
    *,
    source: str,
    ocr_used: bool,
) -> Optional[Dict[str, Any]]:
    cleaned = _normalize_text(text)
    if not cleaned:
        return None
    return {
        "text": cleaned,
        "locator": locator,
        "source": source,
        "ocrUsed": bool(ocr_used),
        "charCount": len(cleaned),
    }


def _join_units(units: List[Dict[str, Any]]) -> str:
    parts = [u.get("text", "") for u in units if u.get("text")]
    return "\n\n".join(parts).strip()


def _summarize_units(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for u in units:
        txt = u.get("text", "") or ""
        out.append(
            {
                "locator": u.get("locator") or {},
                "source": u.get("source"),
                "ocrUsed": bool(u.get("ocrUsed")),
                "charCount": int(u.get("charCount") or len(txt)),
                "preview": txt[:280],
            }
        )
    return out


def _finalize_bundle(
    kind: str,
    mode: str,
    units: List[Dict[str, Any]],
    *,
    ocr_used: bool,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    text = _join_units(units)
    return {
        "text": text,
        "extraction": {
            "kind": kind,
            "mode": mode,
            "ocrUsed": bool(ocr_used),
            "unitCount": len(units),
            "charCount": len(text),
            "units": _summarize_units(units),
            **(extra or {}),
        },
        "groundingUnits": units,
    }


def _ocr_pil_image(image, *, locator: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    if not OCR_ENABLED:
        return None
    try:
        import pytesseract  # type: ignore
        from PIL import ImageOps  # type: ignore

        im = image.convert("RGB")
        w, h = im.size
        max_side = max(w, h)
        if max_side > OCR_IMAGE_MAX_SIDE:
            scale = OCR_IMAGE_MAX_SIDE / float(max_side)
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        im = ImageOps.autocontrast(im)

        txt = pytesseract.image_to_string(im, lang=OCR_LANGS, config="--psm 6")
        cleaned = _normalize_text(txt)
        if len(cleaned) < OCR_IMAGE_MIN_CHARS:
            txt = pytesseract.image_to_string(im, lang=OCR_LANGS, config="--psm 11")
            cleaned = _normalize_text(txt)

        if not cleaned:
            return None

        return _unit(cleaned, locator, source=source, ocr_used=True)
    except Exception:
        return None


def _from_pdf_bytes_bundle(data: bytes) -> Dict[str, Any]:
    native_text = ""
    try:
        native_text = _normalize_text(pdfminer_extract(io.BytesIO(data)) or "")
    except Exception:
        native_text = ""

    native_units: List[Dict[str, Any]] = []
    if native_text:
        u = _unit(
            native_text,
            _locator(kind="document"),
            source="pdfminer",
            ocr_used=False,
        )
        if u:
            native_units.append(u)

    if native_text and len(native_text) >= OCR_PDF_MIN_CHARS:
        return _finalize_bundle("pdf", "native", native_units, ocr_used=False)

    if OCR_ENABLED:
        try:
            from pdf2image import convert_from_bytes  # type: ignore

            pages = convert_from_bytes(
                data,
                dpi=max(72, OCR_PDF_DPI),
                first_page=1,
                last_page=OCR_MAX_PAGES,
            )

            ocr_units: List[Dict[str, Any]] = []
            for idx, page in enumerate(pages, start=1):
                unit = _ocr_pil_image(
                    page,
                    locator=_locator(kind="page", pageNumber=idx),
                    source="tesseract",
                )
                if unit:
                    ocr_units.append(unit)

            if ocr_units:
                return _finalize_bundle(
                    "pdf",
                    "ocr" if not native_units else "hybrid",
                    ocr_units,
                    ocr_used=True,
                    extra={
                        "nativeCharCount": len(native_text),
                        "ocrPageCount": len(ocr_units),
                    },
                )
        except Exception:
            pass

    return _finalize_bundle(
        "pdf",
        "native" if native_units else "empty",
        native_units,
        ocr_used=False,
        extra={"nativeCharCount": len(native_text)},
    )


def _from_docx_bytes_bundle(data: bytes) -> Dict[str, Any]:
    txt = ""
    try:
        with io.BytesIO(data) as bio:
            from docx import Document  # type: ignore

            doc = Document(bio)
            txt = "\n".join(p.text for p in doc.paragraphs)
    except Exception:
        txt = ""

    units: List[Dict[str, Any]] = []
    u = _unit(txt, _locator(kind="document"), source="docx", ocr_used=False)
    if u:
        units.append(u)

    return _finalize_bundle("docx", "native", units, ocr_used=False)


def _extract_from_html(html: str, *, url: Optional[str] = None) -> str:
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

    return _normalize_text(txt or "")


def _from_html_bytes_bundle(data: bytes) -> Dict[str, Any]:
    try:
        html = data.decode("utf-8", "ignore")
    except Exception:
        html = ""

    txt = _extract_from_html(html, url=None)
    units: List[Dict[str, Any]] = []
    u = _unit(txt, _locator(kind="document"), source="html", ocr_used=False)
    if u:
        units.append(u)

    return _finalize_bundle("html", "native", units, ocr_used=False)


def _from_text_bytes_bundle(data: bytes, *, kind: str = "text") -> Dict[str, Any]:
    try:
        txt = data.decode("utf-8", "ignore")
    except Exception:
        txt = ""

    units: List[Dict[str, Any]] = []
    u = _unit(txt, _locator(kind="document"), source="text", ocr_used=False)
    if u:
        units.append(u)

    return _finalize_bundle(kind, "native", units, ocr_used=False)


def _from_image_bytes_bundle(data: bytes, *, file_name: Optional[str] = None) -> Dict[str, Any]:
    units: List[Dict[str, Any]] = []
    try:
        from PIL import Image, ImageSequence  # type: ignore

        with Image.open(io.BytesIO(data)) as im:
            if getattr(im, "is_animated", False):
                for idx, frame in enumerate(ImageSequence.Iterator(im), start=1):
                    unit = _ocr_pil_image(
                        frame.copy(),
                        locator=_locator(kind="image-frame", imageIndex=1, frameNumber=idx),
                        source="tesseract",
                    )
                    if unit:
                        units.append(unit)
                    if idx >= 3:
                        break
            else:
                unit = _ocr_pil_image(
                    im,
                    locator=_locator(kind="image", imageIndex=1, fileName=file_name),
                    source="tesseract",
                )
                if unit:
                    units.append(unit)
    except Exception:
        units = []

    return _finalize_bundle("image", "ocr" if units else "empty", units, ocr_used=bool(units))


def _looks_like_pdf(data: bytes) -> bool:
    return len(data) >= 5 and data[:5] == b"%PDF-"


def _looks_like_html(data: bytes) -> bool:
    head = (data[:2048] or b"").lower()
    return b"<!doctype html" in head or b"<html" in head or b"<body" in head


def _looks_like_png(data: bytes) -> bool:
    return data[:8] == b"\x89PNG\r\n\x1a\n"


def _looks_like_jpeg(data: bytes) -> bool:
    return data[:3] == b"\xff\xd8\xff"


def _looks_like_webp(data: bytes) -> bool:
    return len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def _looks_like_gif(data: bytes) -> bool:
    return data[:6] in (b"GIF87a", b"GIF89a")


def from_text(text: Optional[str]) -> str:
    return text or ""


def from_url(url: str) -> str:
    resp = requests.get(
        url,
        timeout=(URL_CONNECT_TIMEOUT, URL_READ_TIMEOUT),
        headers=_DEFAULT_HEADERS,
        allow_redirects=True,
    )
    resp.raise_for_status()

    ctype = (resp.headers.get("content-type") or "").lower()
    data = resp.content or b""

    url_l = (url or "").lower()
    looks_like_pdf_url = (
        url_l.endswith(".pdf")
        or ".pdf&" in url_l
        or ".pdf?" in url_l
        or "filename=" in url_l
        and ".pdf" in url_l
    )

    is_pdf_header = ("application/pdf" in ctype) or (
        "application/octet-stream" in ctype and looks_like_pdf_url
    )
    is_pdf_magic = _looks_like_pdf(data)

    if is_pdf_header or is_pdf_magic or looks_like_pdf_url:
        return _from_pdf_bytes_bundle(data)["text"]

    html = resp.text or ""
    if not html:
        return ""

    return _extract_from_html(html, url=url)


def from_file(file_bytes: bytes, file_name: Optional[str] = None) -> str:
    return extract_content(file_bytes=file_bytes, file_name=file_name).get("text", "")


def from_path(file_path: str) -> str:
    if not os.path.exists(file_path):
        return ""
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        return from_file(data, file_name=file_path)
    except Exception:
        return ""


def extract_content(
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
) -> Dict[str, Any]:
    if text:
        units: List[Dict[str, Any]] = []
        u = _unit(text, _locator(kind="document"), source="input-text", ocr_used=False)
        if u:
            units.append(u)
        return _finalize_bundle("text", "provided", units, ocr_used=False)

    if url:
        txt = from_url(url)
        units: List[Dict[str, Any]] = []
        u = _unit(txt, _locator(kind="document", url=url), source="url", ocr_used=False)
        if u:
            units.append(u)
        return _finalize_bundle("url", "fetched", units, ocr_used=False)

    if file_path and file_bytes is None:
        try:
            with open(file_path, "rb") as f:
                file_bytes = f.read()
            file_name = file_name or file_path
        except Exception:
            file_bytes = None

    if file_bytes is None:
        return _finalize_bundle("unknown", "empty", [], ocr_used=False)

    name = (file_name or "").lower()

    if name.endswith(".pdf") or _looks_like_pdf(file_bytes):
        return _from_pdf_bytes_bundle(file_bytes)

    if name.endswith(".docx"):
        return _from_docx_bytes_bundle(file_bytes)

    if name.endswith(".html") or name.endswith(".htm") or _looks_like_html(file_bytes):
        return _from_html_bytes_bundle(file_bytes)

    if (
        name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))
        or _looks_like_png(file_bytes)
        or _looks_like_jpeg(file_bytes)
        or _looks_like_webp(file_bytes)
        or _looks_like_gif(file_bytes)
    ):
        return _from_image_bytes_bundle(file_bytes, file_name=file_name)

    if name.endswith(".json"):
        return _from_text_bytes_bundle(file_bytes, kind="json")

    if name.endswith(".xml") or name.endswith(".svg"):
        return _from_text_bytes_bundle(file_bytes, kind="xml")

    if name.endswith(".csv"):
        return _from_text_bytes_bundle(file_bytes, kind="csv")

    if name.endswith(".md"):
        return _from_text_bytes_bundle(file_bytes, kind="markdown")

    return _from_text_bytes_bundle(file_bytes, kind="text")


def extract_text(
    text: Optional[str] = None,
    url: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
) -> str:
    return extract_content(
        text=text,
        url=url,
        file_bytes=file_bytes,
        file_name=file_name,
        file_path=file_path,
    ).get("text", "")