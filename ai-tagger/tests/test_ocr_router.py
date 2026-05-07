from __future__ import annotations

import pathlib
import sys
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ocr_router  # noqa: E402


class OcrRouterTests(unittest.TestCase):
    def test_page_range_accepts_singles_ranges_and_lists(self) -> None:
        self.assertEqual(ocr_router.parse_page_range("1"), [1])
        self.assertEqual(ocr_router.parse_page_range("1-3"), [1, 2, 3])
        self.assertEqual(ocr_router.parse_page_range("1,3,8-10"), [1, 3, 8, 9, 10])

    def test_page_range_rejects_invalid_ranges(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid OCR page range"):
            ocr_router.parse_page_range("4-2")
        with self.assertRaisesRegex(ValueError, "Invalid OCR page range"):
            ocr_router.parse_page_range("1,abc")
        with self.assertRaisesRegex(ValueError, "this PDF has 3 page"):
            ocr_router.parse_page_range("1-4", page_count=3)

    def test_page_limit_requires_range_for_large_pdf(self) -> None:
        with self.assertRaisesRegex(ValueError, "Choose a page range"):
            ocr_router.assert_page_limit(
                page_count=100,
                page_numbers=None,
                max_pages=50,
            )
        ocr_router.assert_page_limit(
            page_count=100,
            page_numbers=[1, 2, 3],
            max_pages=50,
        )

    def test_ocrmypdf_args_are_safe_and_option_mapped(self) -> None:
        args = ocr_router.build_ocrmypdf_args(
            input_path="in.pdf",
            output_path="out.pdf",
            sidecar_path="sidecar.txt",
            options={
                "langs": "eng+hin",
                "pages": "1-3",
                "deskew": True,
                "rotatePages": True,
                "clean": False,
            },
        )

        self.assertIn("--sidecar", args)
        self.assertIn("--deskew", args)
        self.assertIn("--rotate-pages", args)
        self.assertIn("--pages", args)
        self.assertIn("1-3", args)
        self.assertIn("--skip-text", args)
        self.assertNotIn("--clean", args)

    def test_quality_summary_counts_blank_and_weak_pages(self) -> None:
        pages = [
            ocr_router.make_page_result(1, "", "ocrmypdf"),
            ocr_router.make_page_result(2, "short", "ocrmypdf"),
            ocr_router.make_page_result(3, "A useful page of OCR text " * 5, "ocrmypdf"),
        ]
        summary = ocr_router.summarize_pages(pages)

        self.assertEqual(summary["pageCount"], 3)
        self.assertEqual(summary["blankPages"], 1)
        self.assertEqual(summary["weakPages"], 1)
        self.assertGreater(summary["charCount"], 0)

    def test_ocrmypdf_failure_falls_back_to_tesseract(self) -> None:
        fallback_result = {
            "engine": "tesseract_fallback",
            "fallbackUsed": True,
            "pages": [ocr_router.make_page_result(1, "fallback text", "tesseract_fallback")],
            "quality": {"pageCount": 1, "processedPages": 1, "blankPages": 0, "weakPages": 1, "charCount": 13},
            "options": {},
            "errors": [],
        }

        with mock.patch.object(
            ocr_router,
            "_ocr_with_ocrmypdf",
            side_effect=ocr_router.OcrRuntimeError("missing ocrmypdf"),
        ), mock.patch.object(
            ocr_router,
            "_ocr_pdf_with_tesseract",
            return_value=fallback_result,
        ):
            result = ocr_router.ocr_pdf_bytes(
                b"%PDF-1.4",
                options={"enabled": True, "engine": "auto", "fallback": True},
                page_count=1,
            )

        self.assertEqual(result["engine"], "tesseract_fallback")
        self.assertTrue(result["fallbackUsed"])
        self.assertIn("missing ocrmypdf", result["errors"][0])


if __name__ == "__main__":
    unittest.main()
