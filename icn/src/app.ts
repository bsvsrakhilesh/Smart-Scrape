// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import path from "path";
import os from "os";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Response as PWResponse,
} from "playwright";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import pdfParse from "pdf-parse";

dotenv.config();

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const env = {
  PORT: Number(process.env.PORT || 7081),
  HOST: process.env.HOST || "127.0.0.1",
  ICN_NODE_NAME: process.env.ICN_NODE_NAME || os.hostname(),
  ICN_SHARED_SECRET: process.env.ICN_SHARED_SECRET || "",
  ICN_HEADLESS: boolFromEnv(process.env.ICN_HEADLESS, false),
  ICN_NAV_TIMEOUT_MS: Number(process.env.ICN_NAV_TIMEOUT_MS || 90000),
  ICN_ACTION_TIMEOUT_MS: Number(process.env.ICN_ACTION_TIMEOUT_MS || 15000),
  ICN_USER_DATA_DIR:
    process.env.ICN_USER_DATA_DIR || path.join(process.cwd(), "profile"),
  ICN_DEFAULT_LOGIN_URL: process.env.ICN_DEFAULT_LOGIN_URL || "",
  ICN_BROWSER_CHANNEL: process.env.ICN_BROWSER_CHANNEL || "",
  ICN_BROWSER_EXECUTABLE_PATH: process.env.ICN_BROWSER_EXECUTABLE_PATH || "",
  ICN_ALLOWED_ORIGIN: process.env.ICN_ALLOWED_ORIGIN || "*",
};

fs.mkdirSync(env.ICN_USER_DATA_DIR, { recursive: true });

type IcnState = {
  context: BrowserContext | null;
  currentHeadless: boolean | null;
  lastLaunchAt: string | null;
  lastCaptureAt: string | null;
  lastLoginOpenedAt: string | null;
  chain: Promise<unknown>;
};

const state: IcnState = {
  context: null,
  currentHeadless: null,
  lastLaunchAt: null,
  lastCaptureAt: null,
  lastLoginOpenedAt: null,
  chain: Promise.resolve(),
};

type PdfPayload = {
  buffer: Buffer;
  mimeType: string;
  finalUrl: string;
  contentDisposition: string | null;
  note: string;
};

type TextPayload = {
  text: string;
  mimeType: string;
  finalUrl: string;
  note: string;
};

type CaptureRequestBody = {
  url?: string;
  fileName?: string | null;
};

type InspectArticleRequestBody = {
  url?: string;
};

type OpenLoginRequestBody = {
  url?: string | null;
  provider?: "openathens" | "proquest" | "nexis" | "pressreader" | "custom";
};

type FallbackProvider = "pressreader" | "proquest" | "nexis";

type SearchFallbackRequestBody = {
  url?: string;
  providerOrder?: FallbackProvider[];
  maxCandidates?: number;
};

function log(event: string, meta: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service: "institutional-capture-node",
      event,
      ...meta,
    }),
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function providerFromUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.includes("pressreader")) return "pressreader";
    if (host.includes("proquest")) return "proquest";
    if (host.includes("nexis") || host.includes("lexisnexis")) return "nexis";
    if (host.includes("openathens")) return "openathens";
    return host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function sanitizeBaseName(
  input: string | null | undefined,
  fallback: string,
): string {
  const cleaned = String(input || fallback || "capture")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140);

  return cleaned || fallback || "capture";
}

function fileNameFromUrl(
  rawUrl: string,
  fallbackBase: string,
  ext: string,
): string {
  try {
    const u = new URL(rawUrl);
    const last = u.pathname.split("/").filter(Boolean).pop();
    const base = last ? last.replace(/\.[A-Za-z0-9]{1,6}$/, "") : fallbackBase;
    return `${sanitizeBaseName(base, fallbackBase)}.${ext}`;
  } catch {
    return `${sanitizeBaseName(fallbackBase, "capture")}.${ext}`;
  }
}

function resolveLoginTarget(input?: OpenLoginRequestBody): string {
  const explicitUrl = typeof input?.url === "string" ? input.url.trim() : "";

  if (explicitUrl) return explicitUrl;

  switch (input?.provider) {
    case "proquest":
      return "https://www.proquest.com/";
    case "nexis":
      return "https://advance.lexis.com/";
    case "pressreader":
      return "https://www.pressreader.com/catalog";
    case "openathens":
      return env.ICN_DEFAULT_LOGIN_URL || "https://login.openathens.net/";
    default:
      if (env.ICN_DEFAULT_LOGIN_URL) return env.ICN_DEFAULT_LOGIN_URL;
      throw new Error(
        "No login URL provided. Pass a provider or explicit url to /session/open-login.",
      );
  }
}

function parseContentDispositionFileName(
  headerValue: string | null | undefined,
): string | null {
  if (!headerValue) return null;

  const star = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    return decodeURIComponent(star[1]).replace(/\.[A-Za-z0-9]{1,6}$/, "");
  }

  const plain = headerValue.match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) return plain[1].replace(/\.[A-Za-z0-9]{1,6}$/, "");

  return null;
}

function normalizeWhitespace(input: string | null | undefined): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function firstMetaContent(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const content = el?.getAttribute("content") || el?.getAttribute("href");
    const cleaned = normalizeWhitespace(content);
    if (cleaned) return cleaned;
  }
  return null;
}

function resolveMaybeUrl(
  baseUrl: string,
  raw: string | null | undefined,
): string | null {
  const cleaned = normalizeWhitespace(raw);
  if (!cleaned) return null;

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return cleaned;
  }
}

function safeJsonParse<T = unknown>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function flattenJsonLd(input: unknown): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flattenJsonLd);
  if (typeof input !== "object") return [];

  const obj = input as Record<string, unknown>;
  const graph = Array.isArray(obj["@graph"])
    ? (obj["@graph"] as unknown[])
    : [];

  return [obj, ...graph.flatMap(flattenJsonLd)];
}

function collectJsonLdRecords(doc: Document): any[] {
  return Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
    .map((el) => safeJsonParse(el.textContent || ""))
    .flatMap(flattenJsonLd);
}

function extractJsonLdArticleRecord(records: any[]): any | null {
  const preferred = records.find((record) => {
    const type = record?.["@type"];
    const types = Array.isArray(type) ? type : [type];
    return types.some((entry) =>
      typeof entry === "string"
        ? [
            "NewsArticle",
            "Article",
            "ReportageNewsArticle",
            "AnalysisNewsArticle",
            "BlogPosting",
          ].includes(entry)
        : false,
    );
  });

  return preferred || records[0] || null;
}

function extractBylineFromDom(doc: Document): string | null {
  const selectors = [
    '[rel="author"]',
    '[itemprop="author"]',
    ".byline",
    ".article-byline",
    ".author-name",
    '[class*="byline"]',
    '[class*="author"]',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const cleaned = normalizeWhitespace(el?.textContent);
    if (cleaned) return cleaned.replace(/^by\s+/i, "");
  }

  return null;
}

function buildTextPreview(text: string, maxLength = 420): string | null {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return null;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength).trim()}…`
    : cleaned;
}

function detectPaywallSignals(doc: Document, pageText: string): string[] {
  const signals = new Set<string>();

  const selectorHits = [
    '[class*="paywall"]',
    '[id*="paywall"]',
    '[data-test*="paywall"]',
    '[data-testid*="paywall"]',
    '[class*="gateway"]',
    '[id*="gateway"]',
    '[class*="subscribe"]',
    '[class*="subscriber"]',
    '[class*="premium"]',
    '[class*="metered"]',
  ];

  selectorHits.forEach((selector) => {
    if (doc.querySelector(selector)) signals.add(`dom:${selector}`);
  });

  const lowered = pageText.toLowerCase();
  const textIndicators = [
    "subscribe to continue reading",
    "subscribe to read more",
    "subscriber only",
    "subscription required",
    "already a subscriber",
    "sign in to continue reading",
    "register to keep reading",
    "to continue reading",
    "this is a premium article",
    "purchase a subscription",
    "you have reached your limit",
    "exclusive for subscribers",
    "members only",
  ];

  textIndicators.forEach((needle) => {
    if (lowered.includes(needle)) signals.add(`text:${needle}`);
  });

  const restrictedMeta = firstMetaContent(doc, [
    'meta[property="article:content_tier"]',
    'meta[name="content_tier"]',
    'meta[name="cxenseParse:paywall"]',
    'meta[name="article:premium"]',
  ]);

  if (
    restrictedMeta &&
    /(paid|premium|subscriber|metered|register)/i.test(restrictedMeta)
  ) {
    signals.add(`meta:${restrictedMeta}`);
  }

  return Array.from(signals);
}

function inspectArticleFromHtml(input: {
  html: string;
  pageUrl: string;
  contentType: string | null;
}) {
  const dom = new JSDOM(input.html, { url: input.pageUrl });
  const doc = dom.window.document;
  const jsonLdRecords = collectJsonLdRecords(doc);
  const articleRecord = extractJsonLdArticleRecord(jsonLdRecords);

  const readability = new Readability(doc.cloneNode(true) as Document).parse();
  const fullText = normalizeWhitespace(
    readability?.textContent || doc.body?.textContent || "",
  );

  const title = firstNonEmpty(
    firstMetaContent(doc, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="hdl"]',
    ]),
    normalizeWhitespace(articleRecord?.headline),
    normalizeWhitespace(doc.querySelector("h1")?.textContent),
    normalizeWhitespace(doc.title),
  );

  const snippet = firstNonEmpty(
    firstMetaContent(doc, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]),
    normalizeWhitespace(readability?.excerpt),
    buildTextPreview(fullText, 260),
  );

  const canonicalUrl = resolveMaybeUrl(
    input.pageUrl,
    firstMetaContent(doc, ['link[rel="canonical"]', 'meta[property="og:url"]']),
  );

  const sourceName = firstNonEmpty(
    firstMetaContent(doc, [
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
      'meta[name="publisher"]',
    ]),
    normalizeWhitespace(articleRecord?.publisher?.name),
    providerFromUrl(input.pageUrl),
  );

  const author = firstNonEmpty(
    firstMetaContent(doc, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="parsely-author"]',
    ]),
    Array.isArray(articleRecord?.author)
      ? articleRecord.author
          .map((entry: any) => normalizeWhitespace(entry?.name || entry))
          .filter(Boolean)
          .join(", ")
      : normalizeWhitespace(
          articleRecord?.author?.name || articleRecord?.author,
        ),
    extractBylineFromDom(doc),
  );

  const publishedAt = firstNonEmpty(
    firstMetaContent(doc, [
      'meta[property="article:published_time"]',
      'meta[name="publication_date"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]',
      'meta[name="parsely-pub-date"]',
    ]),
    normalizeWhitespace(articleRecord?.datePublished),
    normalizeWhitespace(articleRecord?.dateCreated),
  );

  const h1 = firstNonEmpty(
    normalizeWhitespace(doc.querySelector("h1")?.textContent),
  );
  const textPreview = buildTextPreview(fullText, 420);
  const paywallSignals = detectPaywallSignals(
    doc,
    `${snippet || ""} ${fullText}`,
  );
  const textLength = fullText.length;
  const isLikelyArticle = Boolean(
    title && (snippet || textLength > 280 || articleRecord?.headline),
  );

  const extractionConfidence: "high" | "medium" | "low" = isLikelyArticle
    ? textLength > 1200 || Boolean(articleRecord?.headline)
      ? "high"
      : "medium"
    : title || snippet
      ? "medium"
      : "low";

  return {
    provider: providerFromUrl(input.pageUrl),
    finalUrl: input.pageUrl,
    sourceHost: new URL(input.pageUrl).hostname.replace(/^www\./, ""),
    sourceName,
    title,
    h1,
    canonicalUrl,
    author,
    publishedAt,
    snippet,
    textPreview,
    textLength,
    paywallDetected: paywallSignals.length > 0,
    paywallSignals,
    isLikelyArticle,
    extractionConfidence,
    contentType: input.contentType,
    note: isLikelyArticle
      ? "Structured article signals extracted from the page."
      : "Page opened, but article signals were weak or incomplete.",
  };
}

async function inspectArticlePayload(context: BrowserContext, rawUrl: string) {
  const page = await context.newPage();
  const pdfHits = attachPdfCollectors(page);

  try {
    const response = await page.goto(rawUrl, {
      waitUntil: "domcontentloaded",
      timeout: env.ICN_NAV_TIMEOUT_MS,
    });

    await settlePage(page);

    const maybePdf = await pickPdfPayload(response, pdfHits);
    if (maybePdf) {
      const parsed = await pdfParse(maybePdf.buffer);
      const preview = buildTextPreview(parsed.text || "", 420);

      await page.close();

      return {
        provider: providerFromUrl(maybePdf.finalUrl || rawUrl),
        finalUrl: maybePdf.finalUrl || rawUrl,
        sourceHost: new URL(maybePdf.finalUrl || rawUrl).hostname.replace(
          /^www\./,
          "",
        ),
        sourceName: providerFromUrl(maybePdf.finalUrl || rawUrl),
        title: null,
        h1: null,
        canonicalUrl: maybePdf.finalUrl || rawUrl,
        author: null,
        publishedAt: null,
        snippet: preview,
        textPreview: preview,
        textLength: normalizeWhitespace(parsed.text || "").length,
        paywallDetected: false,
        paywallSignals: [],
        isLikelyArticle: Boolean(preview),
        extractionConfidence: preview ? "medium" : "low",
        contentType: maybePdf.mimeType || "application/pdf",
        note: "The target resolved directly to a PDF during article inspection.",
      } as const;
    }

    const finalUrl = page.url();
    const html = await page.content();
    const contentType = response?.headers()?.["content-type"] || null;

    const inspection = inspectArticleFromHtml({
      html,
      pageUrl: finalUrl,
      contentType,
    });

    await page.close();
    return inspection;
  } catch (error) {
    try {
      await page.close();
    } catch {
      // ignore
    }
    throw error;
  }
}

type FallbackArticleInspection = Awaited<
  ReturnType<typeof inspectArticlePayload>
>;

type FallbackCandidate = {
  provider: FallbackProvider;
  query: string;
  rank: number;
  title: string | null;
  url: string | null;
  snippet: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  score: number;
  scoreBreakdown: {
    title: number;
    source: number;
    date: number;
    snippet: number;
  };
  matchedBy: string[];
};

type FallbackProviderAttemptDebug = {
  query: string;
  inputFound: boolean;
  submitted: boolean;
  startUrl: string;
  resultUrl: string | null;
  pageTitle: string | null;
  anchorCount: number;
  rawCandidateCount: number;
  notes: string[];
};

type FallbackProviderDebug = {
  provider: FallbackProvider;
  startUrl: string;
  attempts: FallbackProviderAttemptDebug[];
  notes: string[];
};

type FallbackSearchPayload = {
  originalUrl: string;
  inspection: FallbackArticleInspection;
  searchedProviders: FallbackProvider[];
  queryVariants: string[];
  candidates: FallbackCandidate[];
  bestCandidate: FallbackCandidate | null;
  debug: FallbackProviderDebug[];
  note: string | null;
};

const FALLBACK_PROVIDER_START_URLS: Record<FallbackProvider, string> = {
  pressreader: "https://www.pressreader.com/catalog",
  proquest: "https://www.proquest.com/",
  nexis: "https://advance.lexis.com/",
};

const FB_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "at",
  "by",
  "from",
  "how",
  "what",
  "why",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
]);

function fbClean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function fbNormalizeForMatch(value: string | null | undefined): string {
  return fbClean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

function fbTokens(value: string | null | undefined): string[] {
  return fbNormalizeForMatch(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !FB_STOPWORDS.has(token));
}

function fbOverlapScore(
  targetTokens: string[],
  candidateTokens: string[],
): number {
  if (!targetTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  const overlap = targetTokens.filter((token) =>
    candidateSet.has(token),
  ).length;
  return overlap / targetTokens.length;
}

function fbScoreTitle(
  targetTitle: string | null,
  candidateTitle: string | null,
): number {
  const targetNorm = fbNormalizeForMatch(targetTitle);
  const candidateNorm = fbNormalizeForMatch(candidateTitle);

  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 1;
  if (
    candidateNorm.includes(targetNorm) ||
    targetNorm.includes(candidateNorm)
  ) {
    return 0.92;
  }

  return fbOverlapScore(fbTokens(targetTitle), fbTokens(candidateTitle));
}

function fbScoreSource(
  targetSource: string | null,
  candidateText: string,
): number {
  const targetNorm = fbNormalizeForMatch(targetSource);
  const candidateNorm = fbNormalizeForMatch(candidateText);

  if (!targetNorm || !candidateNorm) return 0;
  if (candidateNorm.includes(targetNorm)) return 1;

  return Math.min(
    0.75,
    fbOverlapScore(fbTokens(targetSource), fbTokens(candidateText)),
  );
}

function fbScoreDate(
  targetPublishedAt: string | null,
  candidateText: string,
): number {
  if (!targetPublishedAt) return 0;

  const year = targetPublishedAt.slice(0, 4);
  const day = targetPublishedAt.slice(0, 10);
  const candidateNorm = fbNormalizeForMatch(candidateText);

  if (day && candidateNorm.includes(day.toLowerCase())) return 1;
  if (year && candidateNorm.includes(year.toLowerCase())) return 0.55;
  return 0;
}

function fbScoreSnippet(
  targetSnippet: string | null,
  candidateText: string,
): number {
  return fbOverlapScore(fbTokens(targetSnippet), fbTokens(candidateText));
}

function fbBuildQueryVariants(target: FallbackArticleInspection): string[] {
  const year = target.publishedAt?.slice(0, 4) || "";
  const variants = [
    target.title ? `"${target.title}"` : "",
    [target.title, target.sourceName].filter(Boolean).join(" "),
    [target.title, target.sourceName, year].filter(Boolean).join(" "),
    [target.title, target.author].filter(Boolean).join(" "),
  ]
    .map((entry) => fbClean(entry))
    .filter(Boolean);

  return Array.from(new Set(variants));
}

type RawProviderCandidate = {
  title: string | null;
  url: string | null;
  snippet: string | null;
  rawText: string | null;
};

function fbSearchSelectorsForProvider(provider: FallbackProvider): string[] {
  switch (provider) {
    case "pressreader":
      return [
        'input[type="search"]',
        'input[name="q"]',
        'input[name*="search" i]',
        'input[placeholder*="Search" i]',
        'input[aria-label*="Search" i]',
      ];
    case "proquest":
      return [
        'input[name="query"]',
        'textarea[name="query"]',
        'input[type="search"]',
        'input[name="q"]',
        'input[name*="search" i]',
        'input[placeholder*="Search" i]',
        'input[aria-label*="Search" i]',
      ];
    case "nexis":
      return [
        'textarea[name="query"]',
        'input[name="query"]',
        'input[type="search"]',
        'input[name="q"]',
        'input[name*="search" i]',
        'input[placeholder*="Search" i]',
        'input[aria-label*="Search" i]',
      ];
  }
}

async function fbOpenSearchUiIfNeeded(
  page: Page,
  provider: FallbackProvider,
  notes: string[],
): Promise<void> {
  const openers =
    provider === "pressreader"
      ? [
          'button[aria-label*="Search" i]',
          '[role="button"][aria-label*="Search" i]',
          '[class*="search"] button',
          'button[class*="search"]',
        ]
      : [
          'button[aria-label*="Search" i]',
          '[role="button"][aria-label*="Search" i]',
          'button[class*="search"]',
          '[class*="search"] button',
        ];

  for (const selector of openers) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) continue;

    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;

    try {
      await loc.click({ timeout: 1500 });
      notes.push(`opened-search-ui:${selector}`);
      await page.waitForTimeout(400);
      return;
    } catch {
      // ignore
    }
  }
}

async function fbTrySubmitSearch(
  page: Page,
  provider: FallbackProvider,
  query: string,
): Promise<{
  inputFound: boolean;
  submitted: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  await fbOpenSearchUiIfNeeded(page, provider, notes);

  const inputSelectors = fbSearchSelectorsForProvider(provider);

  for (const selector of inputSelectors) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) continue;

    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;

    try {
      await loc.click({ timeout: 2000 });
      await loc.fill("");
      await loc.fill(query);
      notes.push(`filled:${selector}`);
      await loc.press("Enter");
      notes.push(`submitted:${selector}`);
      return { inputFound: true, submitted: true, notes };
    } catch (error) {
      notes.push(`fill-failed:${selector}`);
    }
  }

  notes.push("no-visible-search-input");
  return { inputFound: false, submitted: false, notes };
}

async function fbExtractSearchCandidates(
  page: Page,
  provider: FallbackProvider,
): Promise<RawProviderCandidate[]> {
  return page.evaluate((providerName) => {
    const clean = (value: unknown) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

    const providerCardSelectors: Record<string, string[]> = {
      pressreader: [
        "article",
        "[class*='article']",
        "[class*='story']",
        "[class*='search'] [class*='result']",
        "[class*='result']",
      ],
      proquest: [
        "article",
        "li",
        "[class*='result']",
        "[data-testid*='result']",
        "[class*='searchResults'] > *",
      ],
      nexis: [
        "article",
        "li",
        "[class*='result']",
        "[data-testid*='result']",
        "[class*='search-results'] > *",
      ],
    };

    const selectors = providerCardSelectors[providerName] || [
      "article",
      "li",
      "[class*='result']",
      "div",
    ];

    const candidates: RawProviderCandidate[] = [];
    const seen = new Set<string>();

    const cards = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)),
    );

    for (const card of cards) {
      const anchor = card.querySelector("a[href]") || card.closest("a[href]");

      if (!anchor) continue;

      const href = (anchor as HTMLAnchorElement).href || "";
      const title = clean(anchor.textContent);

      if (!href || !title || title.length < 12) continue;
      if (/^(javascript:|mailto:|tel:)/i.test(href)) continue;

      const rawText = clean(
        (card as HTMLElement).innerText || card.textContent || "",
      );
      if (rawText.length < 35) continue;

      const snippetEl = card.querySelector(
        "p, [class*='snippet'], [class*='summary'], [class*='description'], [class*='deck'], [class*='abstract']",
      );
      const snippet =
        clean(snippetEl?.textContent || "") || rawText.slice(0, 500);

      const key = `${href}__${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        title,
        url: href,
        snippet,
        rawText: rawText.slice(0, 1200),
      });

      if (candidates.length >= 50) break;
    }

    if (candidates.length > 0) return candidates;

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      const href = (anchor as HTMLAnchorElement).href || "";
      const title = clean(anchor.textContent);

      if (!href || !title || title.length < 18) continue;
      if (/^(javascript:|mailto:|tel:)/i.test(href)) continue;
      if (
        /(signin|sign in|login|register|subscribe|privacy|terms|help|contact)/i.test(
          title,
        )
      ) {
        continue;
      }

      const card = anchor.closest("article, li, div, section");
      const rawText = clean(card?.textContent || "");
      if (rawText.length < 40) continue;

      const snippetEl = card?.querySelector(
        "p, [class*='snippet'], [class*='summary'], [class*='description'], [class*='deck'], [class*='abstract']",
      );
      const snippet =
        clean(snippetEl?.textContent || "") || rawText.slice(0, 500);

      const key = `${href}__${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        title,
        url: href,
        snippet,
        rawText: rawText.slice(0, 1200),
      });

      if (candidates.length >= 50) break;
    }

    return candidates;
  }, provider);
}

function fbComputeCandidate(
  provider: FallbackProvider,
  query: string,
  target: FallbackArticleInspection,
  raw: RawProviderCandidate,
): FallbackCandidate {
  const combinedText = [raw.title, raw.snippet, raw.rawText]
    .filter(Boolean)
    .join(" ");

  const titleScore = fbScoreTitle(target.title, raw.title);
  const sourceScore = fbScoreSource(target.sourceName, combinedText);
  const dateScore = fbScoreDate(target.publishedAt, combinedText);
  const snippetScore = fbScoreSnippet(target.snippet, combinedText);

  const total =
    titleScore * 0.6 +
    sourceScore * 0.15 +
    dateScore * 0.1 +
    snippetScore * 0.15;

  const matchedBy: string[] = [];
  if (titleScore >= 0.55) matchedBy.push("title");
  if (sourceScore >= 0.7) matchedBy.push("source");
  if (dateScore >= 0.5) matchedBy.push("date");
  if (snippetScore >= 0.35) matchedBy.push("snippet");

  return {
    provider,
    query,
    rank: 0,
    title: raw.title,
    url: raw.url,
    snippet: raw.snippet,
    sourceName:
      sourceScore >= 0.7 && target.sourceName ? target.sourceName : null,
    publishedAt: null,
    score: Math.round(total * 1000) / 1000,
    scoreBreakdown: {
      title: Math.round(titleScore * 1000) / 1000,
      source: Math.round(sourceScore * 1000) / 1000,
      date: Math.round(dateScore * 1000) / 1000,
      snippet: Math.round(snippetScore * 1000) / 1000,
    },
    matchedBy,
  };
}

function fbDedupCandidates(
  candidates: FallbackCandidate[],
): FallbackCandidate[] {
  const bestByKey = new Map<string, FallbackCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.provider}__${candidate.url || candidate.title || Math.random()}`;
    const existing = bestByKey.get(key);

    if (!existing || candidate.score > existing.score) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => b.score - a.score)
    .map((candidate, idx) => ({
      ...candidate,
      rank: idx + 1,
    }));
}

async function fbSearchOneProvider(
  context: BrowserContext,
  provider: FallbackProvider,
  target: FallbackArticleInspection,
  queryVariants: string[],
  maxCandidates: number,
): Promise<{
  candidates: FallbackCandidate[];
  debug: FallbackProviderDebug;
}> {
  const page = await context.newPage();
  const found: FallbackCandidate[] = [];
  const debug: FallbackProviderDebug = {
    provider,
    startUrl: FALLBACK_PROVIDER_START_URLS[provider],
    attempts: [],
    notes: [],
  };

  try {
    for (const query of queryVariants) {
      await page.goto(FALLBACK_PROVIDER_START_URLS[provider], {
        waitUntil: "domcontentloaded",
        timeout: env.ICN_NAV_TIMEOUT_MS,
      });

      await settlePage(page);

      const startUrl = page.url();
      const submitResult = await fbTrySubmitSearch(page, provider, query);

      if (!submitResult.submitted) {
        debug.attempts.push({
          query,
          inputFound: submitResult.inputFound,
          submitted: false,
          startUrl,
          resultUrl: page.url(),
          pageTitle: await page.title().catch(() => null),
          anchorCount: await page
            .locator("a[href]")
            .count()
            .catch(() => 0),
          rawCandidateCount: 0,
          notes: submitResult.notes,
        });
        continue;
      }

      await page.waitForTimeout(1800);
      try {
        await page.waitForLoadState("networkidle", { timeout: 3500 });
      } catch {
        submitResult.notes.push("networkidle-timeout");
      }

      const anchorCount = await page
        .locator("a[href]")
        .count()
        .catch(() => 0);
      const rawCandidates = await fbExtractSearchCandidates(page, provider);
      const scored = rawCandidates
        .map((raw) => fbComputeCandidate(provider, query, target, raw))
        .filter((candidate) => candidate.score >= 0.18);

      found.push(...scored);

      debug.attempts.push({
        query,
        inputFound: submitResult.inputFound,
        submitted: true,
        startUrl,
        resultUrl: page.url(),
        pageTitle: await page.title().catch(() => null),
        anchorCount,
        rawCandidateCount: rawCandidates.length,
        notes: submitResult.notes,
      });

      if (scored.some((candidate) => candidate.score >= 0.88)) {
        debug.notes.push(`strong-match-found:${query}`);
        break;
      }
    }

    return {
      candidates: fbDedupCandidates(found).slice(0, maxCandidates),
      debug,
    };
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}

async function searchFallbackArticlePayload(
  context: BrowserContext,
  rawUrl: string,
  input: SearchFallbackRequestBody,
): Promise<FallbackSearchPayload> {
  const inspection = await inspectArticlePayload(context, rawUrl);

  const providerOrder =
    Array.isArray(input.providerOrder) && input.providerOrder.length
      ? Array.from(new Set(input.providerOrder)).filter(
          (provider): provider is FallbackProvider =>
            provider === "pressreader" ||
            provider === "proquest" ||
            provider === "nexis",
        )
      : (["pressreader", "proquest", "nexis"] as FallbackProvider[]);

  const queryVariants = fbBuildQueryVariants(inspection);
  const maxCandidates = Math.min(
    Math.max(Number(input.maxCandidates || 8), 1),
    15,
  );

  if (!queryVariants.length) {
    return {
      originalUrl: rawUrl,
      inspection,
      searchedProviders: providerOrder,
      queryVariants: [],
      candidates: [],
      bestCandidate: null,
      debug: [],
      note: "The original page did not expose enough article signals to build a reliable fallback search query.",
    };
  }

  const allCandidates: FallbackCandidate[] = [];
  const debug: FallbackProviderDebug[] = [];

  for (const provider of providerOrder) {
    const providerResult = await fbSearchOneProvider(
      context,
      provider,
      inspection,
      queryVariants,
      maxCandidates,
    );
    allCandidates.push(...providerResult.candidates);
    debug.push(providerResult.debug);
  }

  const candidates = fbDedupCandidates(allCandidates).slice(0, maxCandidates);
  const bestCandidate =
    candidates.length > 0 && candidates[0].score >= 0.55 ? candidates[0] : null;

  return {
    originalUrl: rawUrl,
    inspection,
    searchedProviders: providerOrder,
    queryVariants,
    candidates,
    bestCandidate,
    debug,
    note: bestCandidate
      ? "Fallback search found at least one strong candidate in the institutional sources."
      : "Fallback search completed, but no candidate cleared the confidence threshold yet.",
  };
}

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!env.ICN_SHARED_SECRET) {
    next();
    return;
  }

  const incoming = req.header("x-icn-shared-secret");
  if (incoming !== env.ICN_SHARED_SECRET) {
    res.status(401).json({
      ok: false,
      message: "Unauthorized ICN request.",
    });
    return;
  }

  next();
}

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = state.chain.then(fn, fn) as Promise<T>;
  state.chain = next.catch(() => undefined);
  return next;
}

async function closeContext(): Promise<void> {
  if (!state.context) return;

  try {
    await state.context.close();
  } catch (error) {
    log("context_close_failed", {
      error: errorMessage(error, "close failed"),
    });
  } finally {
    state.context = null;
    state.currentHeadless = null;
  }
}

async function getContext(options?: {
  forceHeaded?: boolean;
}): Promise<BrowserContext> {
  const desiredHeadless = options?.forceHeaded ? false : env.ICN_HEADLESS;

  if (state.context && state.currentHeadless === desiredHeadless) {
    return state.context;
  }

  await closeContext();

  log("context_launch_begin", {
    headless: desiredHeadless,
    userDataDir: env.ICN_USER_DATA_DIR,
  });

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] =
    {
      headless: desiredHeadless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1080 },
      ignoreHTTPSErrors: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    };

  if (env.ICN_BROWSER_EXECUTABLE_PATH) {
    launchOptions.executablePath = env.ICN_BROWSER_EXECUTABLE_PATH;
  } else if (env.ICN_BROWSER_CHANNEL && !desiredHeadless) {
    launchOptions.channel = env.ICN_BROWSER_CHANNEL as "chrome" | "msedge";
  }

  const context = await chromium.launchPersistentContext(
    env.ICN_USER_DATA_DIR,
    launchOptions,
  );

  context.setDefaultNavigationTimeout(env.ICN_NAV_TIMEOUT_MS);
  context.setDefaultTimeout(env.ICN_ACTION_TIMEOUT_MS);

  state.context = context;
  state.currentHeadless = desiredHeadless;
  state.lastLaunchAt = new Date().toISOString();

  log("context_launch_ok", {
    headless: desiredHeadless,
    userDataDir: env.ICN_USER_DATA_DIR,
  });

  return context;
}

async function settlePage(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("domcontentloaded", {
      timeout: env.ICN_NAV_TIMEOUT_MS,
    });
  } catch {
    // ignore
  }

  await page.waitForTimeout(1200);

  try {
    await page.waitForLoadState("networkidle", { timeout: 3000 });
  } catch {
    // ignore
  }
}

function attachPdfCollectors(page: Page): PWResponse[] {
  const hits: PWResponse[] = [];

  page.on("response", (response: PWResponse) => {
    try {
      const headers = response.headers();
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const contentDisposition = String(
        headers["content-disposition"] || "",
      ).toLowerCase();

      const isPdf =
        contentType.includes("application/pdf") ||
        contentDisposition.includes(".pdf") ||
        /\.pdf(?:$|[?#])/i.test(response.url());

      if (isPdf) hits.push(response);
    } catch {
      // ignore collector issues
    }
  });

  return hits;
}

async function pickPdfPayload(
  primaryResponse: PWResponse | null,
  pdfHits: PWResponse[],
): Promise<PdfPayload | null> {
  const candidates: PWResponse[] = [];
  if (primaryResponse) candidates.push(primaryResponse);
  for (const hit of pdfHits) candidates.push(hit);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const res = candidates[i];
    if (!res) continue;

    try {
      const headers = res.headers();
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const contentDisposition = String(headers["content-disposition"] || "");
      const isPdf =
        contentType.includes("application/pdf") ||
        /\.pdf(?:$|[?#])/i.test(res.url());

      if (!isPdf) continue;

      const body = await res.body();
      const buffer = Buffer.from(body);

      if (!buffer.length) continue;

      return {
        buffer,
        mimeType: headers["content-type"] || "application/pdf",
        finalUrl: res.url(),
        contentDisposition,
        note: "Captured from live PDF network response.",
      };
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function findEmbeddedPdfUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const iframe = document.querySelector("iframe[src]");
    if (iframe?.getAttribute("src")) return iframe.getAttribute("src");

    const embed = document.querySelector("embed[src]");
    if (embed?.getAttribute("src")) return embed.getAttribute("src");

    const objectEl = document.querySelector("object[data]");
    if (objectEl?.getAttribute("data")) return objectEl.getAttribute("data");

    const anchor = Array.from(document.querySelectorAll("a[href]"))
      .map((el) => el.getAttribute("href"))
      .find((href) => href && /\.pdf(?:$|[?#])/i.test(href));

    return anchor || null;
  });
}

async function capturePdfPayload(
  context: BrowserContext,
  rawUrl: string,
): Promise<PdfPayload> {
  const page = await context.newPage();
  const pdfHits = attachPdfCollectors(page);

  try {
    const response = await page.goto(rawUrl, {
      waitUntil: "domcontentloaded",
      timeout: env.ICN_NAV_TIMEOUT_MS,
    });

    await settlePage(page);

    const direct = await pickPdfPayload(response, pdfHits);
    if (direct) {
      await page.close();
      return direct;
    }

    const embedded = await findEmbeddedPdfUrl(page);
    if (embedded) {
      const absolute = new URL(embedded, page.url()).toString();
      await page.close();
      return capturePdfPayload(context, absolute);
    }

    const finalUrl = page.url();
    const pageBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    await page.close();

    return {
      buffer: Buffer.from(pageBuffer),
      mimeType: "application/pdf",
      finalUrl,
      contentDisposition: null,
      note: "No raw PDF response found; captured a print-to-PDF snapshot of the authenticated page.",
    };
  } catch (error) {
    try {
      await page.close();
    } catch {
      // ignore
    }
    throw error;
  }
}

function extractReadableText(html: string, pageUrl: string): string {
  const dom = new JSDOM(html, { url: pageUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article?.textContent?.trim()) {
    return article.textContent.trim();
  }

  return dom.window.document.body?.textContent?.trim() || "";
}

async function captureTextPayload(
  context: BrowserContext,
  rawUrl: string,
): Promise<TextPayload> {
  const page = await context.newPage();
  const pdfHits = attachPdfCollectors(page);

  try {
    const response = await page.goto(rawUrl, {
      waitUntil: "domcontentloaded",
      timeout: env.ICN_NAV_TIMEOUT_MS,
    });

    await settlePage(page);

    const maybePdf = await pickPdfPayload(response, pdfHits);
    if (maybePdf) {
      const parsed = await pdfParse(maybePdf.buffer);
      await page.close();

      return {
        text: (parsed.text || "").trim(),
        mimeType: "text/plain; charset=utf-8",
        finalUrl: maybePdf.finalUrl,
        note: "Source resolved to PDF; extracted text from the authenticated PDF bytes.",
      };
    }

    const finalUrl = page.url();
    const html = await page.content();
    let text = extractReadableText(html, finalUrl);

    if (!text) {
      try {
        text = (await page.locator("body").innerText()).trim();
      } catch {
        text = "";
      }
    }

    await page.close();

    return {
      text,
      mimeType: "text/plain; charset=utf-8",
      finalUrl,
      note: "Captured readable text from the authenticated page.",
    };
  } catch (error) {
    try {
      await page.close();
    } catch {
      // ignore
    }
    throw error;
  }
}

const app = express();

app.use(cors({ origin: env.ICN_ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

app.get("/health", async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    nodeName: env.ICN_NODE_NAME,
    headlessDefault: env.ICN_HEADLESS,
    profileDir: env.ICN_USER_DATA_DIR,
    browserReady: Boolean(state.context),
    lastLaunchAt: state.lastLaunchAt,
    lastCaptureAt: state.lastCaptureAt,
    lastLoginOpenedAt: state.lastLoginOpenedAt,
  });
});

app.get(
  "/session/status",
  requireSecret,
  async (_req: Request, res: Response) => {
    try {
      const context = await runExclusive(() => getContext());
      const pages = context.pages().length;
      const cookies = await context.cookies();

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        pages,
        cookieCount: cookies.length,
        headless: state.currentHeadless,
        lastLaunchAt: state.lastLaunchAt,
        lastCaptureAt: state.lastCaptureAt,
        lastLoginOpenedAt: state.lastLoginOpenedAt,
        providerHints: Array.from(
          new Set(
            cookies.map((c) =>
              providerFromUrl(`https://${String(c.domain).replace(/^\./, "")}`),
            ),
          ),
        ).filter((x) => x && x !== "unknown"),
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: errorMessage(error, "Failed to inspect session status."),
      });
    }
  },
);

app.post(
  "/session/open-login",
  requireSecret,
  async (req: Request<{}, {}, OpenLoginRequestBody>, res: Response) => {
    const targetUrl = resolveLoginTarget(req.body);

    try {
      await runExclusive(async () => {
        const context = await getContext({ forceHeaded: true });
        const page = await context.newPage();
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: env.ICN_NAV_TIMEOUT_MS,
        });
        state.lastLoginOpenedAt = new Date().toISOString();
      });

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        message:
          "Interactive login window opened. Complete the IIT/library sign-in in that browser window; the session will persist in this node profile.",
        startUrl: targetUrl,
        browserChannel: env.ICN_BROWSER_CHANNEL || "bundled-chromium",
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: errorMessage(
          error,
          "Could not open interactive login window.",
        ),
      });
    }
  },
);

app.post(
  "/inspect/article",
  requireSecret,
  async (req: Request<{}, {}, InspectArticleRequestBody>, res: Response) => {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";

    if (!rawUrl) {
      res.status(400).json({ ok: false, message: "Body.url is required." });
      return;
    }

    try {
      const context = await runExclusive(() => getContext());
      const inspection = await runExclusive(() =>
        inspectArticlePayload(context, rawUrl),
      );

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        ...inspection,
      });
    } catch (error) {
      log("inspect_article_failed", {
        url: rawUrl,
        error: errorMessage(error, "inspect failed"),
      });

      res.status(500).json({
        ok: false,
        message: errorMessage(
          error,
          "Institutional article inspection failed.",
        ),
      });
    }
  },
);

app.post(
  "/search/fallback/article",
  requireSecret,
  async (req: Request<{}, {}, SearchFallbackRequestBody>, res: Response) => {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";

    if (!rawUrl) {
      res.status(400).json({ ok: false, message: "Body.url is required." });
      return;
    }

    try {
      const context = await runExclusive(() => getContext());
      const payload = await runExclusive(() =>
        searchFallbackArticlePayload(context, rawUrl, req.body || {}),
      );

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        ...payload,
      });
    } catch (error) {
      log("fallback_search_failed", {
        url: rawUrl,
        error: errorMessage(error, "fallback search failed"),
      });

      res.status(500).json({
        ok: false,
        message: errorMessage(error, "Institutional fallback search failed."),
      });
    }
  },
);

app.post(
  "/capture/pdf",
  requireSecret,
  async (req: Request<{}, {}, CaptureRequestBody>, res: Response) => {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const requestedName =
      typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";

    if (!rawUrl) {
      res.status(400).json({ ok: false, message: "Body.url is required." });
      return;
    }

    try {
      const context = await runExclusive(() => getContext());
      const captured = await runExclusive(() =>
        capturePdfPayload(context, rawUrl),
      );
      state.lastCaptureAt = new Date().toISOString();

      const provider = providerFromUrl(captured.finalUrl || rawUrl);
      const fromHeader = parseContentDispositionFileName(
        captured.contentDisposition,
      );
      const fallbackBase = requestedName || fromHeader || provider || "capture";

      const fileName = requestedName
        ? `${sanitizeBaseName(requestedName, fallbackBase).replace(/\.pdf$/i, "")}.pdf`
        : fileNameFromUrl(captured.finalUrl || rawUrl, fallbackBase, "pdf");

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        provider,
        fileName,
        mimeType: captured.mimeType || "application/pdf",
        finalUrl: captured.finalUrl || rawUrl,
        note: captured.note,
        contentBase64: captured.buffer.toString("base64"),
      });
    } catch (error) {
      log("capture_pdf_failed", {
        url: rawUrl,
        error: errorMessage(error, "capture failed"),
      });

      res.status(500).json({
        ok: false,
        message: errorMessage(error, "Institutional PDF capture failed."),
      });
    }
  },
);

app.post(
  "/capture/text",
  requireSecret,
  async (req: Request<{}, {}, CaptureRequestBody>, res: Response) => {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const requestedName =
      typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";

    if (!rawUrl) {
      res.status(400).json({ ok: false, message: "Body.url is required." });
      return;
    }

    try {
      const context = await runExclusive(() => getContext());
      const captured = await runExclusive(() =>
        captureTextPayload(context, rawUrl),
      );
      state.lastCaptureAt = new Date().toISOString();

      const provider = providerFromUrl(captured.finalUrl || rawUrl);
      const fallbackBase = requestedName || provider || "capture";

      const fileName = requestedName
        ? `${sanitizeBaseName(requestedName, fallbackBase).replace(/\.txt$/i, "")}.txt`
        : fileNameFromUrl(captured.finalUrl || rawUrl, fallbackBase, "txt");

      res.json({
        ok: true,
        nodeName: env.ICN_NODE_NAME,
        provider,
        fileName,
        mimeType: captured.mimeType,
        finalUrl: captured.finalUrl || rawUrl,
        note: captured.note,
        contentBase64: Buffer.from(captured.text || "", "utf8").toString(
          "base64",
        ),
      });
    } catch (error) {
      log("capture_text_failed", {
        url: rawUrl,
        error: errorMessage(error, "capture failed"),
      });

      res.status(500).json({
        ok: false,
        message: errorMessage(error, "Institutional text capture failed."),
      });
    }
  },
);

const server = app.listen(env.PORT, env.HOST, () => {
  log("server_started", {
    host: env.HOST,
    port: env.PORT,
    nodeName: env.ICN_NODE_NAME,
    headlessDefault: env.ICN_HEADLESS,
    profileDir: env.ICN_USER_DATA_DIR,
  });
});

async function shutdown(signal: string): Promise<void> {
  log("shutdown_begin", { signal });

  server.close(() => {
    log("http_server_closed", { signal });
  });

  await closeContext();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
