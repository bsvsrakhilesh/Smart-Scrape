from __future__ import annotations

import io
import os
from typing import Optional, Dict, Any, List, Tuple

import re
import json

try:
    from lxml import html as lxml_html  # type: ignore
except Exception:
    lxml_html = None  # type: ignore

import requests
import trafilatura
from pdfminer.high_level import extract_pages, extract_text as pdfminer_extract

from ocr_router import (
    OcrRuntimeError,
    normalize_ocr_options,
    ocr_pdf_bytes,
    ocr_pil_image_to_page,
)

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
    extra: Optional[Dict[str, Any]] = None,
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
        **(extra or {}),
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
                **(
                    {
                        k: u.get(k)
                        for k in ("ocrEngine", "isBlank", "isWeak")
                        if k in u
                    }
                ),
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


def _ocr_pil_image(
    image,
    *,
    locator: Dict[str, Any],
    source: str,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    opts = normalize_ocr_options(ocr_options)
    if not opts["enabled"]:
        return None
    try:
        page = ocr_pil_image_to_page(image, page_number=1, options=opts, engine="tesseract")
        if page.get("isBlank"):
            return None

        return _unit(
            page.get("text") or "",
            locator,
            source=source,
            ocr_used=True,
            extra={
                "ocrEngine": page.get("engine"),
                "isBlank": bool(page.get("isBlank")),
                "isWeak": bool(page.get("isWeak")),
            },
        )
    except Exception:
        return None


def _extract_pdf_native(data: bytes) -> Tuple[List[Dict[str, Any]], Optional[int]]:
    units: List[Dict[str, Any]] = []
    page_count: Optional[int] = None
    try:
        from pdfminer.layout import LTTextContainer  # type: ignore

        for page_idx, page_layout in enumerate(extract_pages(io.BytesIO(data)), start=1):
            page_count = page_idx
            parts: List[str] = []
            for element in page_layout:
                if isinstance(element, LTTextContainer):
                    parts.append(element.get_text())

            unit = _unit(
                "\n".join(parts),
                _locator(kind="page", pageNumber=page_idx),
                source="pdfminer",
                ocr_used=False,
            )
            if unit:
                units.append(unit)
    except Exception:
        units = []
        page_count = None

    return units, page_count


def _extract_pdf_native_units(data: bytes) -> List[Dict[str, Any]]:
    units, _page_count = _extract_pdf_native(data)
    return units


def _pdf_ocr_units(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    units: List[Dict[str, Any]] = []
    for page in result.get("pages") or []:
        if page.get("isBlank"):
            continue
        unit = _unit(
            page.get("text") or "",
            _locator(kind="page", pageNumber=page.get("pageNumber")),
            source=str(page.get("engine") or result.get("engine") or "ocr"),
            ocr_used=True,
            extra={
                "ocrEngine": page.get("engine") or result.get("engine"),
                "isBlank": bool(page.get("isBlank")),
                "isWeak": bool(page.get("isWeak")),
            },
        )
        if unit:
            units.append(unit)
    return units


def _from_pdf_bytes_bundle(
    data: bytes,
    *,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    opts = normalize_ocr_options(ocr_options)
    native_units, page_count = _extract_pdf_native(data)
    native_text = _join_units(native_units)

    try:
        if not native_text:
            native_text = _normalize_text(pdfminer_extract(io.BytesIO(data)) or "")
    except Exception:
        if not native_text:
            native_text = ""

    if native_text and not native_units:
        u = _unit(
            native_text,
            _locator(kind="document"),
            source="pdfminer",
            ocr_used=False,
        )
        if u:
            native_units.append(u)

    base_extra: Dict[str, Any] = {
        "nativeCharCount": len(native_text),
        "pageCount": page_count,
    }

    if native_text and len(native_text) >= int(opts["pdfMinChars"]):
        return _finalize_bundle(
            "pdf",
            "native",
            native_units,
            ocr_used=False,
            extra=base_extra,
        )

    if opts["enabled"]:
        ocr_errors: List[str] = []
        try:
            ocr_result = ocr_pdf_bytes(
                data,
                options=opts,
                page_count=page_count,
            )
            ocr_units = _pdf_ocr_units(ocr_result)
            ocr_errors = list(ocr_result.get("errors") or [])

            if ocr_units:
                return _finalize_bundle(
                    "pdf",
                    "ocr" if not native_units else "hybrid",
                    ocr_units,
                    ocr_used=True,
                    extra={
                        **base_extra,
                        "ocrEngine": ocr_result.get("engine"),
                        "ocrFallbackUsed": bool(ocr_result.get("fallbackUsed")),
                        "ocrLangs": (ocr_result.get("options") or {}).get("langs"),
                        "ocrPageRange": (ocr_result.get("options") or {}).get("pages"),
                        "ocrQuality": ocr_result.get("quality") or {},
                        "ocrErrors": ocr_errors,
                    },
                )
        except (OcrRuntimeError, ValueError) as exc:
            ocr_errors.append(str(exc))
        except Exception as exc:
            ocr_errors.append(f"OCR failed: {exc}")
        base_extra["ocrErrors"] = ocr_errors

    return _finalize_bundle(
        "pdf",
        "native" if native_units else "empty",
        native_units,
        ocr_used=False,
        extra=base_extra,
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


def _from_image_bytes_bundle(
    data: bytes,
    *,
    file_name: Optional[str] = None,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
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
                        ocr_options=ocr_options,
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
                    ocr_options=ocr_options,
                )
                if unit:
                    units.append(unit)
    except Exception:
        units = []

    quality = {
        "pageCount": len(units),
        "processedPages": len(units),
        "blankPages": 0,
        "weakPages": sum(1 for unit in units if unit.get("isWeak")),
        "charCount": sum(int(unit.get("charCount") or 0) for unit in units),
    }
    return _finalize_bundle(
        "image",
        "ocr" if units else "empty",
        units,
        ocr_used=bool(units),
        extra={"ocrEngine": "tesseract", "ocrQuality": quality} if units else None,
    )


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


def _from_url_bundle(
    url: str,
    *,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
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
        bundle = _from_pdf_bytes_bundle(data, ocr_options=ocr_options)
        bundle.setdefault("extraction", {})["url"] = url
        return bundle

    html = resp.text or ""
    if not html:
        return _finalize_bundle("url", "empty", [], ocr_used=False, extra={"url": url})

    txt = _extract_from_html(html, url=url)
    units: List[Dict[str, Any]] = []
    u = _unit(txt, _locator(kind="document", url=url), source="url", ocr_used=False)
    if u:
        units.append(u)
    return _finalize_bundle("url", "fetched", units, ocr_used=False, extra={"url": url})


def from_url(url: str, *, ocr_options: Optional[Dict[str, Any]] = None) -> str:
    return _from_url_bundle(url, ocr_options=ocr_options).get("text", "")


def from_file(
    file_bytes: bytes,
    file_name: Optional[str] = None,
    *,
    ocr_options: Optional[Dict[str, Any]] = None,
) -> str:
    return extract_content(
        file_bytes=file_bytes,
        file_name=file_name,
        ocr_options=ocr_options,
    ).get("text", "")


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
    ocr_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if text:
        units: List[Dict[str, Any]] = []
        u = _unit(text, _locator(kind="document"), source="input-text", ocr_used=False)
        if u:
            units.append(u)
        return _finalize_bundle("text", "provided", units, ocr_used=False)

    if url:
        return _from_url_bundle(url, ocr_options=ocr_options)

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
        return _from_pdf_bytes_bundle(file_bytes, ocr_options=ocr_options)

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
        return _from_image_bytes_bundle(
            file_bytes,
            file_name=file_name,
            ocr_options=ocr_options,
        )

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
    ocr_options: Optional[Dict[str, Any]] = None,
) -> str:
    return extract_content(
        text=text,
        url=url,
        file_bytes=file_bytes,
        file_name=file_name,
        file_path=file_path,
        ocr_options=ocr_options,
    ).get("text", "")
