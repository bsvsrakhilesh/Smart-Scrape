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

test("querySchema accepts explicit PDF exclusion for non-PDF searches", () => {
  const parsed = querySchema.parse({
    q: "air quality",
    excludeFileType: "pdf",
  });

  assert.equal(parsed.excludeFileType, "pdf");
  assert.equal(parsed.fileType, undefined);
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

test("querySchema accepts purpose-scoped collector searches and lane identity", () => {
  const parsed = querySchema.parse({
    q: "pollution enforcement",
    collectorPurposeId: "purpose-1",
    laneKey: "official-record",
  });

  assert.equal(parsed.collectorPurposeId, "purpose-1");
  assert.equal(parsed.laneKey, "official-record");
});

test("rerankBodySchema accepts purpose-scoped reranking", () => {
  const parsed = rerankBodySchema.parse({
    q: "pollution enforcement",
    collectorPurposeId: "purpose-1",
    results: [{ title: "Order", url: "https://example.gov/order.pdf" }],
  });

  assert.equal(parsed.collectorPurposeId, "purpose-1");
});
