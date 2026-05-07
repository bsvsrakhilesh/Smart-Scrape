from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional


class OcrRuntimeError(RuntimeError):
    pass


VALID_ENGINES = {"auto", "ocrmypdf", "tesseract"}
WEAK_PAGE_CHAR_THRESHOLD = max(1, int(os.getenv("OCR_WEAK_PAGE_CHARS", "40")))


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _bool_value(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except Exception:
        return max(minimum, default)


def _first(raw: Dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in raw and raw.get(name) is not None:
            return raw.get(name)
    return None


def normalize_langs(value: Any) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_+.-]", "", str(value or "eng")).strip()
    return cleaned or "eng"


def normalize_ocr_options(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    raw = dict(overrides or {})
    explicit = any(value is not None for value in raw.values())
    enabled_override = _first(raw, "enabled", "ocr_enabled", "ocrEnabled")
    enabled = (
        _bool_value(enabled_override, False)
        if enabled_override is not None
        else (_env_bool("OCR_ENABLED", False) or explicit)
    )

    engine = str(
        _first(raw, "engine", "ocr_engine", "ocrEngine") or os.getenv("OCR_ENGINE", "auto")
    ).strip().lower()
    if engine not in VALID_ENGINES:
        raise ValueError(f"Invalid OCR engine: {engine}")

    return {
        "enabled": enabled,
        "engine": engine,
        "langs": normalize_langs(_first(raw, "langs", "ocr_langs", "ocrLangs") or os.getenv("OCR_LANGS", "eng")),
        "pages": _first(raw, "pages", "ocr_pages", "ocrPages"),
        "deskew": _bool_value(
            _first(raw, "deskew", "ocr_deskew", "ocrDeskew"),
            _env_bool("OCR_DESKEW", True),
        ),
        "rotatePages": _bool_value(
            _first(raw, "rotatePages", "rotate_pages", "ocr_rotate_pages", "ocrRotatePages"),
            _env_bool("OCR_ROTATE_PAGES", True),
        ),
        "clean": _bool_value(
            _first(raw, "clean", "ocr_clean", "ocrClean"),
            _env_bool("OCR_CLEAN", False),
        ),
        "fallback": _bool_value(
            _first(raw, "fallback", "ocr_fallback", "ocrFallback"),
            _env_bool("OCR_FALLBACK", True),
        ),
        "dpi": _int_env("OCR_PDF_DPI", 200, 72),
        "maxPages": _int_env("OCR_MAX_PAGES", 20, 1),
        "pdfMinChars": _int_env("OCR_PDF_MIN_CHARS", 120, 0),
        "imageMaxSide": _int_env("OCR_IMAGE_MAX_SIDE", 2200, 640),
        "imageMinChars": _int_env("OCR_IMAGE_MIN_CHARS", 20, 0),
        "timeoutSeconds": _int_env("OCR_TIMEOUT_SECONDS", 180, 10),
    }


def parse_page_range(pages: Any, page_count: Optional[int] = None) -> Optional[List[int]]:
    raw = str(pages or "").strip()
    if not raw:
        return None

    selected: set[int] = set()
    for part in raw.split(","):
        token = part.strip()
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", token)
        if not match:
            raise ValueError(f"Invalid OCR page range: {raw}")

        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < start:
            raise ValueError(f"Invalid OCR page range: {raw}")

        for page in range(start, end + 1):
            if page_count and page > page_count:
                raise ValueError(
                    f"OCR page range includes page {page}, but this PDF has {page_count} page(s)."
                )
            selected.add(page)
            if len(selected) > 1000:
                raise ValueError("OCR page range is too large.")

    return sorted(selected)


def assert_page_limit(
    *,
    page_count: Optional[int],
    page_numbers: Optional[List[int]],
    max_pages: int,
) -> None:
    limit = max(1, int(max_pages))
    if page_numbers is not None:
        if len(page_numbers) > limit:
            raise ValueError(
                f"OCR page range has {len(page_numbers)} page(s), above OCR_MAX_PAGES={limit}. "
                "Choose a smaller range or raise OCR_MAX_PAGES."
            )
        return

    if page_count and page_count > limit:
        raise ValueError(
            f"Scanned PDF has {page_count} page(s), above OCR_MAX_PAGES={limit}. "
            f"Choose a page range such as 1-{limit}, or raise OCR_MAX_PAGES."
        )


def build_ocrmypdf_args(
    *,
    input_path: str,
    output_path: str,
    sidecar_path: str,
    options: Dict[str, Any],
) -> List[str]:
    args = [
        "--sidecar",
        sidecar_path,
        "--output-type",
        "pdf",
        "--jobs",
        "1",
        "-l",
        normalize_langs(options.get("langs")),
    ]

    if options.get("deskew", True):
        args.append("--deskew")
    if options.get("rotatePages", True):
        args.append("--rotate-pages")
    if options.get("clean", False):
        args.append("--clean")
    if options.get("pages"):
        args.extend(["--pages", str(options["pages"])])

    args.append("--skip-text")
    args.extend([input_path, output_path])
    return args


def make_page_result(page_number: int, text: str, engine: str) -> Dict[str, Any]:
    cleaned = (text or "").replace("\x00", "").strip()
    compact_count = len(re.sub(r"\s+", "", cleaned))
    return {
        "pageNumber": page_number,
        "text": cleaned,
        "charCount": len(cleaned),
        "isBlank": compact_count == 0,
        "isWeak": 0 < compact_count < WEAK_PAGE_CHAR_THRESHOLD,
        "engine": engine,
    }


def summarize_pages(pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "pageCount": len(pages),
        "processedPages": len(pages),
        "blankPages": sum(1 for page in pages if page.get("isBlank")),
        "weakPages": sum(1 for page in pages if page.get("isWeak")),
        "charCount": sum(int(page.get("charCount") or 0) for page in pages),
    }


def _selected_pages(
    *, page_count: Optional[int], options: Dict[str, Any], rendered_count: Optional[int] = None
) -> List[int]:
    page_numbers = parse_page_range(options.get("pages"), page_count)
    assert_page_limit(
        page_count=page_count,
        page_numbers=page_numbers,
        max_pages=int(options["maxPages"]),
    )
    if page_numbers is not None:
        return page_numbers

    count = page_count or rendered_count or int(options["maxPages"])
    return list(range(1, min(count, int(options["maxPages"])) + 1))


def _run_command(command: List[str], *, timeout: int) -> None:
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise OcrRuntimeError(
            f"OCR dependency missing: {command[0]} not found in PATH."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise OcrRuntimeError(f"{command[0]} timed out after {timeout}s.") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise OcrRuntimeError(f"{command[0]} failed: {stderr or completed.returncode}")


def _ocr_with_ocrmypdf(
    data: bytes,
    *,
    options: Dict[str, Any],
    page_count: Optional[int],
) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ai-tagger-ocrmypdf-") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / "input.pdf"
        output_path = tmp_path / "ocr.pdf"
        sidecar_path = tmp_path / "sidecar.txt"
        input_path.write_bytes(data)

        selected = _selected_pages(page_count=page_count, options=options)
        args = build_ocrmypdf_args(
            input_path=str(input_path),
            output_path=str(output_path),
            sidecar_path=str(sidecar_path),
            options=options,
        )
        _run_command(["ocrmypdf", *args], timeout=int(options["timeoutSeconds"]))

        sidecar = sidecar_path.read_text(encoding="utf-8", errors="ignore")
        parts = sidecar.split("\f")
        if not options.get("pages") and not page_count:
            selected = _selected_pages(
                page_count=None,
                options=options,
                rendered_count=max(1, len(parts)),
            )

        pages = [
            make_page_result(page_number, parts[index] if index < len(parts) else "", "ocrmypdf")
            for index, page_number in enumerate(selected)
        ]

    return {
        "engine": "ocrmypdf",
        "fallbackUsed": False,
        "pages": pages,
        "quality": summarize_pages(pages),
        "options": _public_options(options),
        "errors": [],
    }


def _ocr_pil_text(image: Any, options: Dict[str, Any]) -> str:
    import pytesseract  # type: ignore
    from PIL import ImageOps  # type: ignore

    im = image.convert("RGB")
    width, height = im.size
    max_side = max(width, height)
    if max_side > int(options["imageMaxSide"]):
        scale = float(options["imageMaxSide"]) / float(max_side)
        im = im.resize((max(1, int(width * scale)), max(1, int(height * scale))))

    im = ImageOps.autocontrast(im)
    text = pytesseract.image_to_string(im, lang=options["langs"], config="--psm 6")
    if len((text or "").strip()) < int(options["imageMinChars"]):
        text = pytesseract.image_to_string(im, lang=options["langs"], config="--psm 11")
    return text or ""


def ocr_pil_image_to_page(
    image: Any,
    *,
    page_number: int,
    options: Optional[Dict[str, Any]] = None,
    engine: str = "tesseract",
) -> Dict[str, Any]:
    opts = normalize_ocr_options(options)
    return make_page_result(page_number, _ocr_pil_text(image, opts), engine)


def _ocr_pdf_with_tesseract(
    data: bytes,
    *,
    options: Dict[str, Any],
    page_count: Optional[int],
    fallback_used: bool,
) -> Dict[str, Any]:
    from pdf2image import convert_from_bytes  # type: ignore

    selected = _selected_pages(page_count=page_count, options=options)
    if not selected:
        raise OcrRuntimeError("No OCR pages selected.")

    first_page = min(selected)
    last_page = max(selected)
    images = convert_from_bytes(
        data,
        dpi=max(72, int(options["dpi"])),
        first_page=first_page,
        last_page=last_page,
    )
    selected_set = set(selected)
    pages: List[Dict[str, Any]] = []

    for offset, image in enumerate(images):
        page_number = first_page + offset
        if page_number not in selected_set:
            continue
        pages.append(
            make_page_result(
                page_number,
                _ocr_pil_text(image, options),
                "tesseract_fallback" if fallback_used else "tesseract",
            )
        )

    return {
        "engine": "tesseract_fallback" if fallback_used else "tesseract",
        "fallbackUsed": fallback_used,
        "pages": pages,
        "quality": summarize_pages(pages),
        "options": _public_options(options),
        "errors": [],
    }


def _public_options(options: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "langs": options["langs"],
        "pages": options.get("pages") or None,
        "deskew": bool(options.get("deskew", True)),
        "rotatePages": bool(options.get("rotatePages", True)),
        "clean": bool(options.get("clean", False)),
        "maxPages": int(options["maxPages"]),
    }


def ocr_pdf_bytes(
    data: bytes,
    *,
    options: Optional[Dict[str, Any]] = None,
    page_count: Optional[int] = None,
) -> Dict[str, Any]:
    opts = normalize_ocr_options(options)
    if not opts["enabled"]:
        raise OcrRuntimeError("OCR is disabled. Set OCR_ENABLED=true or pass OCR options.")

    engine = opts["engine"]
    if engine == "tesseract":
        return _ocr_pdf_with_tesseract(
            data,
            options=opts,
            page_count=page_count,
            fallback_used=False,
        )

    try:
        return _ocr_with_ocrmypdf(data, options=opts, page_count=page_count)
    except Exception as exc:
        if engine == "ocrmypdf" or not opts["fallback"]:
            raise
        result = _ocr_pdf_with_tesseract(
            data,
            options=opts,
            page_count=page_count,
            fallback_used=True,
        )
        result.setdefault("errors", []).append(str(exc))
        return result


def get_ocr_readiness() -> Dict[str, Any]:
    try:
        opts = normalize_ocr_options({})
        config_error = None
    except Exception as exc:
        opts = {
            "enabled": False,
            "engine": os.getenv("OCR_ENGINE", "auto"),
            "langs": os.getenv("OCR_LANGS", "eng"),
            "maxPages": _int_env("OCR_MAX_PAGES", 20, 1),
        }
        config_error = str(exc)

    return {
        "enabled": bool(opts["enabled"]),
        "engine": opts["engine"],
        "langs": opts["langs"],
        "ocrmypdfAvailable": shutil.which("ocrmypdf") is not None,
        "tesseractAvailable": shutil.which("tesseract") is not None,
        "popplerAvailable": shutil.which("pdftoppm") is not None,
        "maxPages": opts["maxPages"],
        "configError": config_error,
    }


__all__ = [
    "OcrRuntimeError",
    "assert_page_limit",
    "build_ocrmypdf_args",
    "get_ocr_readiness",
    "make_page_result",
    "normalize_ocr_options",
    "ocr_pdf_bytes",
    "ocr_pil_image_to_page",
    "parse_page_range",
    "summarize_pages",
]
