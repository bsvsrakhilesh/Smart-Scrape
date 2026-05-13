from __future__ import annotations

import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import (  # noqa: E402
    _extract_phrases,
    _extract_signal_terms,
    _is_good_tag_candidate,
    _tokenize,
)


class TagCandidateQualityTests(unittest.TestCase):
    def test_rejects_short_noisy_ocr_phrases_from_logs(self) -> None:
        for value in ("ncr the", "cr the", "order sub", "caqm dated", "tci tur"):
            self.assertFalse(_is_good_tag_candidate(value), value)

    def test_keeps_useful_domain_and_location_phrases(self) -> None:
        for value in ("GRAP Stage", "IP Estate", "NTPC Bhawan", "DMRC Ltd"):
            self.assertTrue(_is_good_tag_candidate(value), value)

    def test_phrase_extraction_drops_stopword_edge_and_generic_bigrams(self) -> None:
        phrases = _extract_phrases(
            _tokenize("NCR the Order Sub CAQM dated IP Estate DMRC Ltd"),
            topk=20,
        )

        self.assertNotIn("ncr the", phrases)
        self.assertNotIn("order sub", phrases)
        self.assertNotIn("caqm dated", phrases)
        self.assertIn("ip estate", phrases)
        self.assertIn("dmrc ltd", phrases)

    def test_signal_extraction_drops_title_case_ocr_fragments(self) -> None:
        signals = [term.casefold() for term in _extract_signal_terms("Order Sub CAQM dated IP Estate")]

        self.assertNotIn("order sub", signals)
        self.assertNotIn("caqm dated", signals)
        self.assertIn("ip estate", signals)


if __name__ == "__main__":
    unittest.main()
