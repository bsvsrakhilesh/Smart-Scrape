import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";

import { probeUrlKind } from "../services/urlProbe.service";

const SAFE_DNS_RESULT = [{ address: "93.184.216.34", family: 4 }];

function mockSafeDns(t: TestContext) {
  t.mock.method(dns as any, "lookup", async () => SAFE_DNS_RESULT);
}

test("probeUrlKind blocks private DNS targets before HEAD or range fetch", async (t) => {
  t.mock.method(dns as any, "lookup", async () => [
    { address: "10.1.2.3", family: 4 },
  ]);
  t.mock.method(globalThis as any, "fetch", async () => {
    assert.fail("fetch should not run for a private DNS target");
  });

  await assert.rejects(
    () => probeUrlKind("https://metadata.example.internal/report.pdf"),
    (error: any) =>
      error?.status === 422 && /SSRF denied/.test(String(error?.message)),
  );
});

test("probeUrlKind falls back from unknown HEAD to range without losing SSRF guard", async (t) => {
  mockSafeDns(t);
  const calls: Array<{ url: string; method: string | undefined }> = [];

  t.mock.method(globalThis as any, "fetch", async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }

    return new Response("%PDF-1.7\n", {
      status: 206,
      headers: { "content-type": "application/octet-stream" },
    });
  });

  const out = await probeUrlKind("https://example.gov/files/order.pdf");

  assert.equal(out.kind, "pdf");
  assert.equal(out.method, "range");
  assert.deepEqual(calls, [
    { url: "https://example.gov/files/order.pdf", method: "HEAD" },
    { url: "https://example.gov/files/order.pdf", method: "GET" },
  ]);
});

test("probeUrlKind denies redirects to private targets before following them", async (t) => {
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
    if (url === "https://example.gov/redirect.pdf") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://metadata.example.internal/latest.pdf" },
      });
    }
    assert.fail(`unexpected fetch for ${url}`);
  });

  await assert.rejects(
    () => probeUrlKind("https://example.gov/redirect.pdf"),
    (error: any) =>
      error?.status === 422 && /SSRF denied/.test(String(error?.message)),
  );

  assert.deepEqual(fetchedUrls, ["https://example.gov/redirect.pdf"]);
});
