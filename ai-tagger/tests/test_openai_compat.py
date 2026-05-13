from __future__ import annotations

import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from openai_compat import chat_completion_kwargs  # noqa: E402


class OpenAICompatTests(unittest.TestCase):
    def test_omits_temperature_for_default_temperature_models(self) -> None:
        kwargs = chat_completion_kwargs(
            model="gpt-5-mini",
            temperature=0,
            max_completion_tokens=2600,
        )

        self.assertEqual(kwargs, {"max_completion_tokens": 2600})

    def test_keeps_temperature_for_models_that_support_it(self) -> None:
        kwargs = chat_completion_kwargs(
            model="gpt-4o-mini",
            temperature=0.1,
            max_completion_tokens=700,
        )

        self.assertEqual(
            kwargs,
            {
                "temperature": 0.1,
                "max_completion_tokens": 700,
            },
        )


if __name__ == "__main__":
    unittest.main()
