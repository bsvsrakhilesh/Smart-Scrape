import test from "node:test";
import assert from "node:assert/strict";

import { querySchema, rerankBodySchema } from "../routes/search.schemas";

test("querySchema accepts site-only collector searches", () => {
  const parsed = querySchema.parse({
    site: "example.com",
    yearFrom: 2020,
    fileType: "pdf",
  });

  assert.equal(parsed.site, "example.com");
  assert.equal(parsed.q, undefined);
  assert.equal(parsed.fileType, "pdf");
});

test("querySchema still rejects underspecified free-text searches", () => {
  const parsed = querySchema.safeParse({ q: "a" });

  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.equal(parsed.error.issues[0]?.path[0], "q");
});

test("rerankBodySchema accepts site-only reranks with structured filters", () => {
  const parsed = rerankBodySchema.parse({
    site: "example.com",
    results: [
      {
        title: "Example",
        url: "https://example.com/report",
      },
    ],
    yearFrom: 2020,
    region: "India",
  });

  assert.equal(parsed.site, "example.com");
  assert.equal(parsed.q, undefined);
  assert.equal(parsed.results.length, 1);
});
