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
