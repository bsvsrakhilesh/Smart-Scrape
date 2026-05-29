import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { canonicalizeUrl } from "../utils/urlCanonical";

type CanonicalCase = {
  name: string;
  input: string;
  expected: string;
};

function loadGoldenCases(): CanonicalCase[] {
  const candidates = [
    path.resolve(process.cwd(), "test-fixtures", "urlCanonical.golden.json"),
    path.resolve(process.cwd(), "..", "test-fixtures", "urlCanonical.golden.json"),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(file, "Shared canonicalization fixture must exist");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    canonicalize?: CanonicalCase[];
  };
  return parsed.canonicalize ?? [];
}

test("canonicalizeUrl matches shared golden cases", () => {
  for (const c of loadGoldenCases()) {
    assert.equal(canonicalizeUrl(c.input), c.expected, c.name);
  }
});

test("canonicalizeUrl collapses duplicate collector URLs to a stable evidence key", () => {
  const expected = "https://example.com/reports/air-quality?a=1&b=2";

  const variants = [
    " HTTPS://Example.COM:443/reports//air-quality///?utm_source=newsletter&b=2&a=1#section ",
    "https://example.com/reports/air-quality?b=2&a=1&utm_medium=social",
    "example.com/reports/air-quality/?a=1&b=2&gclid=abc",
    "https://example.com./reports/air-quality?fbclid=abc&b=2&a=1#duplicate",
  ];

  assert.deepEqual(
    variants.map((url) => canonicalizeUrl(url)),
    variants.map(() => expected),
  );
});

test("canonicalizeUrl keeps meaningful collector URL state distinct", () => {
  assert.equal(
    canonicalizeUrl(
      "https://example.com/report?utm_campaign=noise&page=2&year=2024",
    ),
    "https://example.com/report?page=2&year=2024",
  );

  assert.notEqual(
    canonicalizeUrl("https://example.com/report?page=2&year=2024"),
    canonicalizeUrl("https://example.com/report?page=2&year=2023"),
  );

  assert.notEqual(
    canonicalizeUrl("https://example.com/report?page=2&year=2024"),
    canonicalizeUrl("http://example.com/report?page=2&year=2024"),
  );
});

test("canonicalizeUrl preserves case-sensitive path distinctions", () => {
  assert.notEqual(
    canonicalizeUrl("https://example.com/Report"),
    canonicalizeUrl("https://example.com/report"),
  );
});

test("canonicalizeUrl preserves repeated query parameter value order", () => {
  assert.notEqual(
    canonicalizeUrl("https://example.com/search?tag=air&tag=policy"),
    canonicalizeUrl("https://example.com/search?tag=policy&tag=air"),
  );
});

test("canonicalizeUrl rejects malformed and unsupported source URL inputs", () => {
  assert.equal(canonicalizeUrl(""), "");
  assert.equal(canonicalizeUrl("   "), "");
  assert.equal(canonicalizeUrl("not a url ???"), "");
  assert.equal(canonicalizeUrl("mailto:test@example.com"), "");
  assert.equal(canonicalizeUrl("ftp://example.com/file"), "");
  assert.equal(canonicalizeUrl("javascript:alert(1)"), "");
  assert.equal(canonicalizeUrl("//example.com/report"), "https://example.com/report");
});
