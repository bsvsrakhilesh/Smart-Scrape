import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import dns from "node:dns/promises";

const SAFE_DNS_RESULT = [{ address: "93.184.216.34", family: 4 }];

async function loadDiscoveryService() {
  process.env.DATABASE_URL ||=
    "postgresql://user:pass@localhost:5432/smartscrape_test";

  const [{ discoverDocumentsForUrl, extractStaticPdfCandidates }, prisma] =
    await Promise.all([
      import("../services/documentDiscovery.service"),
      import("../config/database"),
    ]);

  let prismaClient: any = prisma;
  while (prismaClient && !prismaClient.url && prismaClient.default) {
    prismaClient = prismaClient.default;
  }

  return {
    discoverDocumentsForUrl,
    extractStaticPdfCandidates,
    prisma: prismaClient,
  };
}

function mockDiscoveryRunDb(t: TestContext, prisma: any, sourceUrl: string) {
  const updates: any[] = [];
  const upserts: any[] = [];

  replaceMethod(t, prisma.url, "findUnique", async () => ({
    id: 42,
    url: sourceUrl,
    title: "Source page",
  }));
  replaceMethod(t, prisma.urlDiscoveryRun, "create", async () => ({
    id: "run-test-1",
  }));
  replaceMethod(t, prisma.urlDiscoveryRun, "update", async (args: any) => {
    updates.push(args);
    return { id: "run-test-1", ...args.data };
  });
  replaceMethod(t, prisma.urlDiscoveredDocument, "upsert", async (args: any) => {
    upserts.push(args);
    return {
      id: "doc-test-1",
      sourceUrlId: 42,
      capturedFiles: [],
      firstSeenAt: new Date("2026-05-29T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-29T00:00:00.000Z"),
      ...args.create,
    };
  });

  return { updates, upserts };
}

function replaceMethod(
  t: TestContext,
  target: any,
  name: string,
  replacement: (...args: any[]) => any,
) {
  const original = target[name];
  Object.defineProperty(target, name, {
    configurable: true,
    value: replacement,
  });
  t.after(() => {
    Object.defineProperty(target, name, {
      configurable: true,
      value: original,
    });
  });
}

function last<T>(values: T[]) {
  return values[values.length - 1];
}

test("extractStaticPdfCandidates finds linked, embedded, and scripted PDFs", async () => {
  const { extractStaticPdfCandidates } = await loadDiscoveryService();

  const html = `
    <html>
      <head><title>Orders</title></head>
      <body>
        <h1>GRAP Orders</h1>
        <ul>
          <li>
            <a href="/docs/order-16-04-2026.pdf">
              Order dated 16.04.2026 - Implementation under Stage-I
            </a>
          </li>
          <li>
            <iframe src="../files/advisory.pdf"></iframe>
          </li>
        </ul>
        <script>
          window.open('/downloads/notification.pdf?download=1');
        </script>
      </body>
    </html>
  `;

  const out = extractStaticPdfCandidates(
    html,
    "https://example.gov/archive/orders/index.html",
  );

  assert.equal(out.length, 3);
  assert.ok(out.some((c) => c.url === "https://example.gov/docs/order-16-04-2026.pdf"));
  assert.ok(out.some((c) => c.url === "https://example.gov/archive/files/advisory.pdf"));
  assert.ok(
    out.some(
      (c) =>
        c.url === "https://example.gov/downloads/notification.pdf?download=1",
    ),
  );
});

test("extractStaticPdfCandidates ignores non-document links", async () => {
  const { extractStaticPdfCandidates } = await loadDiscoveryService();

  const out = extractStaticPdfCandidates(
    `<a href="/about">About</a><a href="mailto:test@example.gov">Mail</a>`,
    "https://example.gov",
  );

  assert.equal(out.length, 0);
});

test("discoverDocumentsForUrl blocks collection when robots.txt disallows the source path", async (t) => {
  const { discoverDocumentsForUrl, prisma } = await loadDiscoveryService();
  const sourceUrl = "https://example.gov/blocked/report-index";
  const { updates, upserts } = mockDiscoveryRunDb(t, prisma, sourceUrl);

  t.mock.method(dns as any, "lookup", async () => SAFE_DNS_RESULT);
  t.mock.method(globalThis as any, "fetch", async (input: any) => {
    assert.equal(String(input), "https://example.gov/robots.txt");
    return new Response("User-agent: *\nDisallow: /blocked", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  });

  await assert.rejects(
    () => discoverDocumentsForUrl({ sourceUrlId: 42, useBrowserFallback: false }),
    (error: any) =>
      error?.code === "ROBOTS_BLOCKED" &&
      error?.status === 403 &&
      /Blocked by robots\.txt/.test(error.message),
  );

  assert.equal(upserts.length, 0);
  assert.equal(last(updates)?.data.status, "FAILED");
  assert.equal(last(updates)?.data.errorCode, "ROBOTS_BLOCKED");
});

test("discoverDocumentsForUrl denies private source hosts before any network fetch", async (t) => {
  const { discoverDocumentsForUrl, prisma } = await loadDiscoveryService();
  const sourceUrl = "https://metadata.example.internal/report-index";
  const { updates, upserts } = mockDiscoveryRunDb(t, prisma, sourceUrl);

  t.mock.method(dns as any, "lookup", async () => [
    { address: "10.1.2.3", family: 4 },
  ]);
  t.mock.method(globalThis as any, "fetch", async () => {
    assert.fail("fetch should not run for a private source host");
  });

  await assert.rejects(
    () => discoverDocumentsForUrl({ sourceUrlId: 42, useBrowserFallback: false }),
    (error: any) =>
      error?.code === "SSRF_DENIED" &&
      error?.status === 422 &&
      /SSRF denied/.test(error.message),
  );

  assert.equal(upserts.length, 0);
  assert.equal(last(updates)?.data.status, "FAILED");
  assert.equal(last(updates)?.data.errorCode, "SSRF_DENIED");
});

test("discoverDocumentsForUrl does not fetch or persist private linked PDF candidates", async (t) => {
  const { discoverDocumentsForUrl, prisma } = await loadDiscoveryService();
  const sourceUrl = "https://example.gov/reports";
  const { updates, upserts } = mockDiscoveryRunDb(t, prisma, sourceUrl);
  const fetchedUrls: string[] = [];

  t.mock.method(dns as any, "lookup", async (hostname: string) => {
    if (hostname === "metadata.example.internal") {
      return [{ address: "169.254.169.254", family: 4 }];
    }
    return SAFE_DNS_RESULT;
  });

  t.mock.method(globalThis as any, "fetch", async (input: any, init?: any) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url === "https://example.gov/robots.txt") {
      return new Response("User-agent: *\nAllow: /", { status: 200 });
    }
    if (url === sourceUrl && init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url === sourceUrl) {
      return new Response(
        `<html><body>
          <a href="https://metadata.example.internal/secret.pdf">
            Internal metadata report
          </a>
        </body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    assert.fail(`unexpected fetch for ${url}`);
  });

  await assert.rejects(
    () => discoverDocumentsForUrl({ sourceUrlId: 42, useBrowserFallback: false }),
    (error: any) =>
      error?.code === "SSRF_DENIED" &&
      error?.status === 422 &&
      /SSRF denied/.test(error.message),
  );

  assert.deepEqual(fetchedUrls, [
    "https://example.gov/robots.txt",
    "https://example.gov/reports",
    "https://example.gov/reports",
  ]);
  assert.equal(upserts.length, 0);
  assert.equal(last(updates)?.data.status, "FAILED");
  assert.equal(last(updates)?.data.errorCode, "SSRF_DENIED");
});

test("discoverDocumentsForUrl denies robots redirects to private targets", async (t) => {
  const { discoverDocumentsForUrl, prisma } = await loadDiscoveryService();
  const sourceUrl = "https://example.gov/reports";
  const { updates, upserts } = mockDiscoveryRunDb(t, prisma, sourceUrl);
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

  await assert.rejects(
    () => discoverDocumentsForUrl({ sourceUrlId: 42, useBrowserFallback: false }),
    (error: any) =>
      error?.code === "SSRF_DENIED" &&
      error?.status === 422 &&
      /SSRF denied/.test(error.message),
  );

  assert.deepEqual(fetchedUrls, ["https://example.gov/robots.txt"]);
  assert.equal(upserts.length, 0);
  assert.equal(last(updates)?.data.status, "FAILED");
  assert.equal(last(updates)?.data.errorCode, "SSRF_DENIED");
});
