import { expect, test, type Page, type Route } from "@playwright/test";

function now() {
  return new Date().toISOString();
}

async function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function installUrlCollectorApi(page: Page) {
  let deleted = false;

  const purpose = {
    id: "purpose-1",
    title: "Delhi Air Quality",
    researchQuestion: "What official records mention GRAP Stage IV?",
    jurisdiction: "Delhi",
    region: "NCR",
    yearFrom: null,
    yearTo: null,
    sourcePreferences: [],
    targetActors: [],
    outputGoal: null,
    status: "active",
    summary: {
      savedUrlCount: 0,
      capturedEvidenceCount: 0,
      governanceReadyDocumentCount: 0,
    },
    authoritySources: [
      {
        key: "caqm",
        label: "CAQM",
        domain: "caqm.nic.in",
        evidenceRole: "Primary orders",
        reason: "Primary commission for GRAP and air-quality management orders in Delhi-NCR.",
        confidence: 96,
        queryHints: ["GRAP", "Stage IV", "CAQM"],
        documentTerms: ["order", "direction", "revocation"],
      },
    ],
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/collector-purposes") {
      return json(route, deleted ? [] : [purpose]);
    }

    if (method === "GET" && pathname === "/api/search") {
      return json(
        route,
        [
          {
            title: "CAQM issues Stage IV directions",
            url: "https://caqm.nic.in/orders/stage-iv.pdf",
            snippet: "Official order about Stage IV restrictions.",
            ranking: { score: 0.97, reasons: ["official"], rank: 1 },
            purposeRelevance: {
              score: 0.98,
              matchedTerms: ["grap", "stage"],
              reason: "Matches purpose terms: grap, stage Official source match: CAQM",
            },
          },
        ],
        200,
        {
          "x-next-page": "",
          "x-has-more": "0",
          "x-total-results": "1",
          "x-collector-search-id": "search-1",
        },
      );
    }

    if (method === "POST" && pathname === "/api/urls/exists") {
      return json(route, { exists: {} });
    }

    if (method === "DELETE" && pathname === "/api/collector-purposes/purpose-1") {
      deleted = true;
      return json(route, { ok: true });
    }

    if (method === "POST" && pathname === "/api/search/rerank") {
      return json(route, []);
    }

    return json(route, {});
  });
}

test("url collector clears stale results after deleting the active purpose", async ({ page }) => {
  await installUrlCollectorApi(page);

  await page.goto("/app/url-collector?purposeId=purpose-1");

  await expect(page.getByRole("heading", { name: "URL Collector" })).toBeVisible();
  await page.getByLabel("Website").fill("caqm.nic.in");
  await page.getByLabel("Keywords").fill("grap stage iv");
  await page.getByRole("button", { name: "Search the web" }).click();

  await expect(page.getByText("CAQM issues Stage IV directions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete purpose" })).toBeVisible();

  await page.getByRole("button", { name: "Delete purpose" }).click();
  await page
    .getByRole("dialog", { name: "Delete research purpose?" })
    .getByRole("button", { name: "Delete purpose" })
    .click();

  await expect(page.getByText("Start by entering a website and keywords above.")).toBeVisible();
  await expect(page.getByText("CAQM issues Stage IV directions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save to purpose/i })).toHaveCount(0);
});
