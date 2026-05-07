import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectorSearchQuery,
  formatAppliedCollectorSearchPlan,
  inferPreferredCollectorCapture,
  isDirectPdfSearchResult,
  normalizeCollectorKeywords,
  normalizeCollectorWebsite,
  suggestCollectorCaptureName,
} from "../utils/urlCollector";
import type { SearchResult } from "../lib/types";

test("normalizeCollectorWebsite strips scheme, path, and www prefix", () => {
  assert.equal(
    normalizeCollectorWebsite("https://www.example.com/path?q=1"),
    "example.com",
  );
  assert.equal(normalizeCollectorWebsite("example.com/reports"), "example.com");
});

test("normalizeCollectorKeywords keeps AND groups clean and OR groups explicit", () => {
  const out = normalizeCollectorKeywords(
    'governance, enforcement | smog tower, "Delhi High Court"',
  );

  assert.equal(
    out,
    '(governance enforcement) OR ("smog tower" "Delhi High Court")',
  );
});

test("formatAppliedCollectorSearchPlan shows structured filters without polluting the query", () => {
  const query = buildCollectorSearchQuery(
    normalizeCollectorKeywords("air quality, governance"),
  );

  const out = formatAppliedCollectorSearchPlan(query, {
    site: "example.com",
    yearFrom: 2020,
    yearTo: 2024,
    jurisdiction: "Delhi High Court",
    region: "South Asia",
    fileType: "pdf",
  });

  assert.equal(
    out,
    '\"air quality\" governance | site=example.com | years=2020-2024 | jurisdiction=\"Delhi High Court\" | region=\"South Asia\" | format=pdf',
  );
  assert.equal(out.includes("filetype:"), false);
  assert.equal(out.includes("after:"), false);
  assert.equal(out.includes("before:"), false);
});

test("formatAppliedCollectorSearchPlan shows PDF exclusion as exclusion, not html-only", () => {
  const out = formatAppliedCollectorSearchPlan("air quality", {
    excludeFileType: "pdf",
  });

  assert.equal(out, "air quality | format=exclude-pdf");
  assert.equal(out.includes("format=html"), false);
});

test("inferPreferredCollectorCapture prefers PDF for official document types and PDF urls", () => {
  const courtOrder: SearchResult = {
    title: "Order",
    url: "https://example.com/order",
    intelligence: {
      docType: "court_order",
      sourceType: "court",
      fileTypeHint: "html",
      confidence: "high",
    },
  };

  const article: SearchResult = {
    title: "Article",
    url: "https://example.com/news",
    intelligence: {
      docType: "news_article",
      sourceType: "news",
      fileTypeHint: "html",
      confidence: "medium",
    },
  };

  const directPdf: SearchResult = {
    title: "PDF",
    url: "https://example.com/report.pdf?download=1",
  };

  assert.equal(inferPreferredCollectorCapture(courtOrder), "pdf");
  assert.equal(inferPreferredCollectorCapture(article), "text");
  assert.equal(inferPreferredCollectorCapture(directPdf), "pdf");
});

test("isDirectPdfSearchResult distinguishes PDFs from container pages", () => {
  assert.equal(
    isDirectPdfSearchResult({
      title: "Report",
      url: "https://example.gov/report.pdf",
    }),
    true,
  );

  assert.equal(
    isDirectPdfSearchResult({
      title: "Orders",
      url: "https://example.gov/orders",
      intelligence: {
        docType: "official_document",
        sourceType: "government",
        fileTypeHint: "html",
        confidence: "high",
      },
    }),
    false,
  );
});

test("suggestCollectorCaptureName prefers embedded pdf filenames and keeps a stable extension", () => {
  const out = suggestCollectorCaptureName(
    "https://sci.gov.in/export?filename=Important%20Order.PDF",
    "https://sci.gov.in/export?filename=Important%20Order.PDF",
    "pdf",
  );

  assert.equal(out, "Important Order.pdf");
});
