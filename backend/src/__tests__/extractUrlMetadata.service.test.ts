import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import dns from "dns/promises";

import { extractUrlMetadata } from "../services/extract.service";

const SAFE_DNS_RESULT = [{ address: "93.184.216.34", family: 4 }];

function mockSafeDns(t: TestContext) {
  t.mock.method(dns as any, "lookup", async () => SAFE_DNS_RESULT);
}

function mockHtmlUrl(t: TestContext, html: string, status = 200) {
  mockSafeDns(t);
  t.mock.method(axios as any, "head", async () => ({
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
  t.mock.method(axios as any, "get", async () => ({
    status,
    data: html,
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
}

function isoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

test("extractUrlMetadata prioritizes article JSON-LD publication metadata", async (t) => {
  mockHtmlUrl(
    t,
    `<!doctype html>
    <html>
      <head>
        <title>Clean Air Action Plan - Example Gazette</title>
        <meta property="og:title" content="Clean Air Action Plan" />
        <meta name="author" content="Asha Rao" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebPage",
                "dateModified": "2026-05-02T12:00:00.000Z"
              },
              {
                "@type": "NewsArticle",
                "datePublished": "2026-04-16T00:00:00.000Z",
                "author": [
                  { "@type": "Person", "name": "Asha Rao" },
                  { "@type": "Organization", "name": "Centre for Clean Air" }
                ]
              }
            ]
          }
        </script>
      </head>
      <body>
        <article>
          <h1>Clean Air Action Plan</h1>
          <p>Air board approved a new plan with verifiable monitoring.</p>
        </article>
      </body>
    </html>`,
  );

  const out = await extractUrlMetadata(
    "https://gazette.example.org/clean-air-action-plan",
  );

  assert.deepEqual(out.authors, ["Asha Rao", "Centre for Clean Air"]);
  assert.equal(isoDate(out.publishedAt), "2026-04-16");
  assert.deepEqual(out.publishedAtMeta, {
    source: "jsonld",
    confidence: 0.85,
  });
  assert.match(out.snippet, /verifiable monitoring/);
});

test("extractUrlMetadata falls back to HTML meta authors and dates", async (t) => {
  mockHtmlUrl(
    t,
    `<!doctype html>
    <html>
      <head>
        <title>Board Minutes</title>
        <meta name="parsely-author" content="Delhi Air Board" />
        <meta property="article:published_time" content="2025-11-07T09:15:00.000Z" />
        <script type="application/ld+json">{ invalid json }</script>
      </head>
      <body>
        <article>
          <h1>Board Minutes</h1>
          <p>Minutes include enforcement milestones and agency commitments.</p>
        </article>
      </body>
    </html>`,
  );

  const out = await extractUrlMetadata(
    "https://agency.example.org/board/minutes",
  );

  assert.deepEqual(out.authors, ["Delhi Air Board"]);
  assert.equal(isoDate(out.publishedAt), "2025-11-07");
  assert.equal(out.publishedAtMeta.source, "html_meta");
  assert.equal(out.publishedAtMeta.confidence, 0.65);
  assert.deepEqual(out.publishedAtMeta.details, {
    raw: "2025-11-07T09:15:00.000Z",
  });
});

test("extractUrlMetadata uses valid URL date patterns only when page metadata is absent", async (t) => {
  mockHtmlUrl(
    t,
    `<!doctype html>
    <html>
      <head><title>Archived order</title></head>
      <body><article><p>Archived order without embedded metadata.</p></article></body>
    </html>`,
  );

  const out = await extractUrlMetadata(
    "https://orders.example.org/archive/2024/02/29/order-17",
  );

  assert.equal(isoDate(out.publishedAt), "2024-02-29");
  assert.deepEqual(out.publishedAtMeta, {
    source: "url_pattern",
    confidence: 0.35,
  });
});

test("extractUrlMetadata does not roll impossible URL dates into a false publication date", async (t) => {
  mockHtmlUrl(
    t,
    `<!doctype html>
    <html>
      <head><title>Broken archive path</title></head>
      <body><article><p>Archive path has malformed date segments.</p></article></body>
    </html>`,
  );

  const out = await extractUrlMetadata(
    "https://orders.example.org/archive/2024/13/40/order-17",
  );

  assert.equal(out.publishedAt, null);
  assert.deepEqual(out.publishedAtMeta, {
    source: "unknown",
    confidence: 0.0,
  });
});

test("extractUrlMetadata reports unknown provenance when fetch fallback has no date signal", async (t) => {
  mockSafeDns(t);
  t.mock.method(axios as any, "head", async () => ({
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  t.mock.method(axios as any, "get", async () => {
    throw new Error("network unavailable");
  });

  const url = "https://blocked.example.org/story-without-date";
  const out = await extractUrlMetadata(url);

  assert.equal(out.title, url);
  assert.equal(out.snippet, "");
  assert.deepEqual(out.authors, []);
  assert.equal(out.publishedAt, null);
  assert.deepEqual(out.publishedAtMeta, {
    source: "unknown",
    confidence: 0.0,
  });
});

test("extractUrlMetadata blocks private DNS targets before fetching metadata", async (t) => {
  t.mock.method(dns as any, "lookup", async () => [
    { address: "10.1.2.3", family: 4 },
  ]);
  t.mock.method(axios as any, "head", async () => {
    assert.fail("HEAD should not run for a private DNS target");
  });
  t.mock.method(axios as any, "get", async () => {
    assert.fail("GET should not run for a private DNS target");
  });

  await assert.rejects(
    () => extractUrlMetadata("https://metadata.example.internal/report"),
    /Blocked private\/internal IP/,
  );
});
