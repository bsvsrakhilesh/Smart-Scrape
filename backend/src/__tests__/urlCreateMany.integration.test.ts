import test from "node:test";
import assert from "node:assert/strict";

test("createManyUrls deduplicates noisy collector URLs by canonical_url in the database", async (t) => {
  const testDatabaseUrl = process.env.SMARTSCRAPE_TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    t.skip("set SMARTSCRAPE_TEST_DATABASE_URL to run the URL dedup database integration test");
    return;
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.SMARTSCRAPE_DISABLE_AUTO_TAG_QUEUE = "true";

  const [{ canonicalizeUrl }, { default: prisma }, { createManyUrls }] =
    await Promise.all([
      import("../utils/urlCanonical"),
      import("../config/database"),
      import("../services/url.service"),
    ]);

  const uniqueHost = `canonical-it-${Date.now()}-${process.pid}.example.test`;
  const expectedCanonical = canonicalizeUrl(
    `https://${uniqueHost}/orders/2024/report.pdf?download=1`,
  );
  const noisyDuplicates = [
    `https://${uniqueHost}/orders/2024/report.pdf?utm_source=collector&download=1#page=4`,
    `https://${uniqueHost.toUpperCase()}:443/orders//2024/report.pdf/?download=1`,
    `${uniqueHost}/orders/2024/report.pdf?download=1&fbclid=abc`,
  ];

  await prisma.url.deleteMany({
    where: { canonical_url: expectedCanonical },
  });

  try {
    const result = await createManyUrls(
      noisyDuplicates.map((url, index) => ({
        url,
        title: `Canonical integration duplicate ${index + 1}`,
        snippet: "Fixture row for URL canonicalization database integration.",
      })),
    );

    assert.equal(result.added, 1);
    assert.equal(result.skipped, 2);

    const storedRows = await prisma.url.findMany({
      where: { canonical_url: expectedCanonical },
      select: {
        id: true,
        url: true,
        canonical_url: true,
        normalizedDomain: true,
      },
    });

    assert.equal(storedRows.length, 1);
    assert.equal(storedRows[0].canonical_url, expectedCanonical);
    assert.equal(storedRows[0].normalizedDomain, uniqueHost);
    assert.equal(new Set(result.rows.map((row) => row.id)).size, 1);
  } finally {
    await prisma.url.deleteMany({
      where: { canonical_url: expectedCanonical },
    });
    await prisma.$disconnect();
  }
});
