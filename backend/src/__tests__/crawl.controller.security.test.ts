import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import type { NextFunction, Request, Response } from "express";

const SAFE_DNS_RESULT = [{ address: "93.184.216.34", family: 4 }];

after(async () => {
  const { aiTagFileQueue } = await import("../queues/aiTagFile.queue");
  await aiTagFileQueue.close().catch(() => undefined);
  await aiTagFileQueue.disconnect().catch(() => undefined);
});

async function loadCrawlHandlers() {
  process.env.DATABASE_URL ||=
    "postgresql://user:pass@localhost:5432/smartscrape_test";
  const handlers = await import("../controllers/crawl.controller");
  const { aiTagFileQueue } = await import("../queues/aiTagFile.queue");
  aiTagFileQueue.on("error", () => undefined);
  return handlers;
}

function mockResponse() {
  const out = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  return out as unknown as Response & typeof out;
}

function mockRequest(url: string) {
  return {
    body: { url, accessMode: "public" },
    requestId: "test-request",
  } as unknown as Request;
}

function mockSafeDns(t: TestContext) {
  t.mock.method(dns as any, "lookup", async () => SAFE_DNS_RESULT);
}

test("crawlTextHandler blocks robots-disallowed pages before page capture", async (t) => {
  const { crawlTextHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://example.gov/blocked/page");
  const res = mockResponse();
  const next: NextFunction = (error?: any) => {
    assert.fail(`next should not be called: ${error?.message || error}`);
  };

  mockSafeDns(t);
  t.mock.method(globalThis as any, "fetch", async (input: any) => {
    assert.equal(String(input), "https://example.gov/robots.txt");
    return new Response("User-agent: *\nDisallow: /blocked", {
      status: 200,
    });
  });

  await crawlTextHandler(req, res, next);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { message: "Blocked by robots.txt" });
});

test("crawlPdfHandler blocks robots-disallowed PDFs before capture", async (t) => {
  const { crawlPdfHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://example.gov/private/report.pdf");
  const res = mockResponse();
  const next: NextFunction = (error?: any) => {
    assert.fail(`next should not be called: ${error?.message || error}`);
  };

  mockSafeDns(t);
  t.mock.method(globalThis as any, "fetch", async (input: any) => {
    assert.equal(String(input), "https://example.gov/robots.txt");
    return new Response("User-agent: *\nDisallow: /private", {
      status: 200,
    });
  });

  await crawlPdfHandler(req, res, next);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { message: "Blocked by robots.txt" });
});

test("crawlTextHandler denies private DNS targets before robots or page fetch", async (t) => {
  const { crawlTextHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://metadata.example.internal/page");
  const res = mockResponse();
  let nextError: any = null;

  t.mock.method(dns as any, "lookup", async () => [
    { address: "169.254.169.254", family: 4 },
  ]);
  t.mock.method(globalThis as any, "fetch", async () => {
    assert.fail("fetch should not run for private crawl targets");
  });

  await crawlTextHandler(req, res, (error?: any) => {
    nextError = error;
  });

  assert.equal(res.body, undefined);
  assert.equal(nextError?.status, 422);
  assert.match(String(nextError?.message), /SSRF denied/);
});

test("crawlTextHandler denies robots redirects to private targets", async (t) => {
  const { crawlTextHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://example.gov/page");
  const res = mockResponse();
  let nextError: any = null;
  const fetchedUrls: string[] = [];

  t.mock.method(dns as any, "lookup", async (hostname: string) => {
    if (hostname === "metadata.example.internal") {
      return [{ address: "169.254.169.254", family: 4 }];
    }
    return SAFE_DNS_RESULT;
  });
  t.mock.method(globalThis as any, "fetch", async (input: any) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url === "https://example.gov/robots.txt") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://metadata.example.internal/robots.txt" },
      });
    }
    assert.fail(`unexpected fetch for ${url}`);
  });

  await crawlTextHandler(req, res, (error?: any) => {
    nextError = error;
  });

  assert.equal(res.body, undefined);
  assert.equal(nextError?.status, 422);
  assert.match(String(nextError?.message), /SSRF denied/);
  assert.deepEqual(fetchedUrls, ["https://example.gov/robots.txt"]);
});

test("crawlPdfHandler denies robots redirects to private targets", async (t) => {
  const { crawlPdfHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://example.gov/report.pdf");
  const res = mockResponse();
  let nextError: any = null;
  const fetchedUrls: string[] = [];

  t.mock.method(dns as any, "lookup", async (hostname: string) => {
    if (hostname === "metadata.example.internal") {
      return [{ address: "10.1.2.3", family: 4 }];
    }
    return SAFE_DNS_RESULT;
  });
  t.mock.method(globalThis as any, "fetch", async (input: any) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url === "https://example.gov/robots.txt") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://metadata.example.internal/robots.txt" },
      });
    }
    assert.fail(`unexpected fetch for ${url}`);
  });

  await crawlPdfHandler(req, res, (error?: any) => {
    nextError = error;
  });

  assert.equal(res.body, undefined);
  assert.equal(nextError?.status, 422);
  assert.match(String(nextError?.message), /SSRF denied/);
  assert.deepEqual(fetchedUrls, ["https://example.gov/robots.txt"]);
});

test("crawlPdfHandler denies private DNS targets before robots or PDF capture", async (t) => {
  const { crawlPdfHandler } = await loadCrawlHandlers();
  const req = mockRequest("https://metadata.example.internal/report.pdf");
  const res = mockResponse();
  let nextError: any = null;

  t.mock.method(dns as any, "lookup", async () => [
    { address: "10.1.2.3", family: 4 },
  ]);
  t.mock.method(globalThis as any, "fetch", async () => {
    assert.fail("fetch should not run for private crawl targets");
  });

  await crawlPdfHandler(req, res, (error?: any) => {
    nextError = error;
  });

  assert.equal(res.body, undefined);
  assert.equal(nextError?.status, 422);
  assert.match(String(nextError?.message), /SSRF denied/);
});
