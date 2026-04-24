import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeUrl } from "../utils/urlCanonical";

test("canonicalizeUrl normalizes host, path, params, and fragment", () => {
  const out = canonicalizeUrl(
    "Example.com:443/a//b///c/?b=2&utm_source=newsletter&a=1#section",
  );

  assert.equal(out, "https://example.com/a/b/c?a=1&b=2");
});

test("canonicalizeUrl drops extended tracking params consistently", () => {
  const out = canonicalizeUrl(
    "https://www.example.com/report/?msclkid=1&igshid=2&mkt_tok=3&mc_eid=4&keep=yes",
  );

  assert.equal(out, "https://www.example.com/report?keep=yes");
});
