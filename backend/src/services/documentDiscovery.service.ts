import dns from "node:dns/promises";
import fs from "fs";
import * as ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import puppeteer, { Browser, LaunchOptions } from "puppeteer-core";
import prisma from "../config/database";
import { env } from "../config/env";
import { createDom } from "../utils/dom";
import { canonicalizeUrl } from "../utils/urlCanonical";
import { probeUrlKind } from "./urlProbe.service";
import { log } from "../utils/logger";

export type DiscoveryMethod =
  | "direct_url"
  | "html_link"
  | "html_embed"
  | "html_attr"
  | "script_reference"
  | "browser_dom"
  | "browser_network";

export type DiscoveredPdfDocument = {
  id: string;
  sourceUrlId: number;
  discoveryRunId: string | null;
  url: string;
  canonicalUrl: string;
  title: string;
  anchorText: string | null;
  contextText: string | null;
  dateHint: string | null;
  rawDateHint: string | null;
  fileNameHint: string | null;
  contentType: string | null;
  contentLength: number | null;
  verified: boolean;
  score: number;
  confidence: "high" | "medium" | "low";
  discoveryMethod: DiscoveryMethod | string;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  capturedAt: string | null;
  captureError: string | null;
  capturedFiles?: Array<{
    id: string;
    fileName: string;
    createdAt: string;
    sha256: string | null;
  }>;
};

export type DiscoverySummary = {
  discoveredCount: number;
  capturedCount: number;
  verifiedCount: number;
  lastDiscoveredAt: string | null;
};

type RawCandidate = {
  url: string;
  title?: string | null;
  anchorText?: string | null;
  contextText?: string | null;
  method: DiscoveryMethod;
  rawMeta?: Record<string, any>;
};

type VerifiedCandidate = RawCandidate & {
  canonicalUrl: string;
  fileNameHint: string | null;
  contentType: string | null;
  contentLength: number | null;
  verified: boolean;
  score: number;
  confidence: "high" | "medium" | "low";
  dateHint: Date | null;
  rawDateHint: string | null;
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const HTML_MAX_BYTES = Math.max(
  256 * 1024,
  Number(process.env.PDF_DISCOVERY_MAX_HTML_BYTES || 5 * 1024 * 1024),
);

const DISCOVERY_MAX_CANDIDATES = Math.max(
  10,
  Number(process.env.PDF_DISCOVERY_MAX_CANDIDATES || 120),
);

const RANGE_SNIFF_BYTES = 4095;

const DEFAULT_CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Chromium\\Application\\chrome.exe",
].filter(Boolean);

function db() {
  return prisma as any;
}

function isPrivateIp(ip: string) {
  const a = ipaddr.parse(ip);
  return (
    a.range() !== "unicast" ||
    ["private", "loopback", "linkLocal", "uniqueLocal"].includes(a.range()) ||
    ip === "169.254.169.254"
  );
}

async function resolveAndGuard(hostname: string) {
  const addrs = await dns.lookup(hostname, { all: true, family: 4 });
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      const err: any = new Error("SSRF denied: private/metadata IP");
      err.status = 422;
      err.code = "SSRF_DENIED";
      throw err;
    }
  }
}

async function fetchWithTimeout(
  url: string,
  ms = 15000,
  init: RequestInit = {},
): Promise<Response> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(to);
  }
}

async function isRobotsAllowed(targetUrl: string) {
  const u = new URL(targetUrl);
  await resolveAndGuard(u.hostname);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;

  try {
    const r = await fetchWithTimeout(robotsUrl, 5000);
    if (!r.ok) return true;
    const body = await r.text();
    const robots = robotsParser(robotsUrl, body);
    return robots.isAllowed(targetUrl, "SmartScrape/1.0") !== false;
  } catch {
    return true;
  }
}

function isPdfMagic(buf: Buffer) {
  const max = Math.min(buf.length - 5, 1024);
  for (let i = 0; i <= max; i++) {
    if (
      buf[i] === 0x25 &&
      buf[i + 1] === 0x50 &&
      buf[i + 2] === 0x44 &&
      buf[i + 3] === 0x46 &&
      buf[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function normalizeSpace(s: unknown, max = 1200) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function tryDecodeUrlish(raw: string): string {
  let out = String(raw || "").trim();
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next.trim();
    } catch {
      break;
    }
  }
  return out;
}

function looksLikePdfUrl(raw: string) {
  const s = String(raw || "").toLowerCase();
  return /\.pdf(?:$|[?#&])/i.test(s) || s.includes(".pdf?");
}

function hasDownloadishUrl(raw: string) {
  return /(?:download|file|document|attachment|view|handler|link|writereaddata|read|open|docid|fileid)/i.test(
    raw,
  );
}

function hasDocumentishText(raw: string) {
  return /\b(pdf|download|order|notification|circular|advisory|direction|report|notice|gazette|minutes|document)\b/i.test(
    raw,
  );
}

function shouldConsiderCandidate(raw: string, text: string) {
  const decoded = tryDecodeUrlish(raw);
  const lower = decoded.toLowerCase();
  if (!decoded) return false;
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return false;
  }
  return (
    looksLikePdfUrl(decoded) ||
    /(?:^|[?&#])(file|filename|pdf|download|path|attachment)=/i.test(lower) ||
    (hasDocumentishText(text) && hasDownloadishUrl(lower))
  );
}

function normalizeCandidateUrl(raw: string, baseUrl: string): string | null {
  const decoded = tryDecodeUrlish(raw);
  if (!decoded) return null;
  if (/^javascript:/i.test(decoded)) return null;

  try {
    const abs = new URL(decoded, baseUrl);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    abs.hash = "";
    return abs.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const directRe =
    /(?:https?:\/\/|\/|\.\.?\/)[^"'`\s<>)]*?\.pdf(?:\?[^"'`\s<>)]*)?/gi;
  let dm: RegExpExecArray | null;
  while ((dm = directRe.exec(text)) !== null) {
    if (dm[0]) out.push(dm[0]);
  }

  const keyedRe =
    /(?:file|filename|pdf|pdfUrl|downloadUrl|path|documentUrl)\s*[:=]\s*['"`]([^'"`]+)['"`]/gi;
  let km: RegExpExecArray | null;
  while ((km = keyedRe.exec(text)) !== null) {
    if (km[1]) out.push(km[1]);
  }

  const openRe = /window\.open\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let om: RegExpExecArray | null;
  while ((om = openRe.exec(text)) !== null) {
    if (om[1]) out.push(om[1]);
  }

  return Array.from(new Set(out));
}

function closestContext(el: Element) {
  const host = el.closest("tr, li, article, section, p, div") || el;
  return normalizeSpace(host.textContent, 1800);
}

function pageHeading(doc: Document) {
  return (
    normalizeSpace(doc.querySelector("h1")?.textContent, 200) ||
    normalizeSpace(doc.querySelector("title")?.textContent, 200)
  );
}

function fileNameFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    for (const [, value] of u.searchParams.entries()) {
      const v = String(value || "");
      if (v.toLowerCase().includes(".pdf")) {
        return decodeURIComponent(v.split(/[\\/]/).pop() || "document.pdf");
      }
    }
    const base = decodeURIComponent(u.pathname.split("/").pop() || "");
    if (!base) return null;
    return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  } catch {
    return null;
  }
}

function titleFromCandidate(c: RawCandidate) {
  const preferred =
    normalizeSpace(c.title, 260) ||
    normalizeSpace(c.anchorText, 260) ||
    normalizeSpace(c.contextText, 260);
  if (preferred) return preferred;
  return fileNameFromUrl(c.url)?.replace(/\.pdf$/i, "") || "Discovered PDF";
}

function parseDateHint(text: string): { date: Date | null; raw: string | null } {
  const s = String(text || "");

  const dmy = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(dt.getTime())) return { date: dt, raw: dmy[0] };
  }

  const ymd = s.match(/\b((?:19|20)\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(dt.getTime())) return { date: dt, raw: ymd[0] };
  }

  return { date: null, raw: null };
}

function queryTokens(query?: string | null) {
  return Array.from(
    new Set(
      String(query || "")
        .toLowerCase()
        .replace(/site:[^\s]+/g, " ")
        .split(/[^a-z0-9]+/i)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3),
    ),
  );
}

function scoreCandidate(
  c: RawCandidate,
  opts: { query?: string | null; verified: boolean },
) {
  const haystack = `${c.url} ${c.title || ""} ${c.anchorText || ""} ${
    c.contextText || ""
  }`.toLowerCase();
  let score = 0.18;

  if (opts.verified) score += 0.28;
  if (looksLikePdfUrl(c.url)) score += 0.18;
  if (hasDocumentishText(haystack)) score += 0.16;
  if (parseDateHint(haystack).date) score += 0.08;
  if (c.method === "browser_network") score += 0.08;

  const tokens = queryTokens(opts.query);
  if (tokens.length) {
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    score += Math.min(0.22, (hits / tokens.length) * 0.22);
  }

  const clamped = Math.max(0, Math.min(1, score));
  const confidence: "high" | "medium" | "low" =
    clamped >= 0.72 ? "high" : clamped >= 0.46 ? "medium" : "low";
  return { score: Number(clamped.toFixed(4)), confidence };
}

export function extractStaticPdfCandidates(
  html: string,
  sourceUrl: string,
): RawCandidate[] {
  const dom = createDom(html, sourceUrl);
  const doc = dom.window.document;
  const heading = pageHeading(doc);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();

  const push = (
    raw: string,
    method: DiscoveryMethod,
    anchorText?: string | null,
    contextText?: string | null,
    rawMeta?: Record<string, any>,
  ) => {
    const text = `${anchorText || ""} ${contextText || ""} ${heading}`;
    if (!shouldConsiderCandidate(raw, text)) return;
    const normalized = normalizeCandidateUrl(raw, sourceUrl);
    if (!normalized) return;
    const key = canonicalizeUrl(normalized) || normalized;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      url: normalized,
      title: anchorText || contextText || heading || fileNameFromUrl(normalized),
      anchorText: anchorText || null,
      contextText: contextText || null,
      method,
      rawMeta,
    });
  };

  doc
    .querySelectorAll("a[href], iframe[src], embed[src], object[data], link[href]")
    .forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const attr =
        el.getAttribute("href") ||
        el.getAttribute("src") ||
        el.getAttribute("data") ||
        "";
      const anchorText = normalizeSpace(el.textContent, 500);
      const contextText = closestContext(el);
      const method: DiscoveryMethod =
        tag === "iframe" || tag === "embed" || tag === "object"
          ? "html_embed"
          : "html_link";
      push(attr, method, anchorText, contextText, { tag, attr });
    });

  doc.querySelectorAll("*").forEach((el) => {
    const anchorText = normalizeSpace(el.textContent, 500);
    const contextText = closestContext(el);

    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (
        name === "href" ||
        name === "src" ||
        name === "data" ||
        name.startsWith("data-") ||
        name === "onclick"
      ) {
        if (name === "onclick" || /^javascript:/i.test(value)) {
          extractUrlsFromText(value).forEach((u) =>
            push(u, "script_reference", anchorText, contextText, {
              attr: name,
            }),
          );
        } else {
          push(value, "html_attr", anchorText, contextText, { attr: name });
        }
      }
    }
  });

  doc.querySelectorAll("meta[content]").forEach((el) => {
    const value = el.getAttribute("content") || "";
    push(value, "html_attr", heading, heading, { tag: "meta" });
  });

  doc.querySelectorAll("script:not([src])").forEach((el) => {
    const script = String(el.textContent || "");
    extractUrlsFromText(script).forEach((u) =>
      push(u, "script_reference", heading, heading, { tag: "script" }),
    );
  });

  return out.slice(0, DISCOVERY_MAX_CANDIDATES);
}

async function fetchHtml(sourceUrl: string): Promise<string> {
  const res = await fetchWithTimeout(sourceUrl, 25_000, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    const err: any = new Error(`Source page returned HTTP ${res.status}`);
    err.code = "SOURCE_FETCH_FAILED";
    err.status = res.status;
    throw err;
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct && !ct.includes("html") && !ct.includes("xml") && !ct.includes("text")) {
    const err: any = new Error(`Source page is not HTML (${ct})`);
    err.code = "SOURCE_NOT_HTML";
    err.status = 422;
    throw err;
  }

  const length = Number(res.headers.get("content-length") || 0);
  if (length && length > HTML_MAX_BYTES) {
    const err: any = new Error("Source page is too large to inspect safely.");
    err.code = "SOURCE_TOO_LARGE";
    err.status = 413;
    throw err;
  }

  const text = await res.text();
  return text.slice(0, HTML_MAX_BYTES);
}

async function verifyPdfCandidate(
  candidateUrl: string,
  referer: string,
): Promise<{
  verified: boolean;
  contentType: string | null;
  contentLength: number | null;
}> {
  const u = new URL(candidateUrl);
  await resolveAndGuard(u.hostname);

  let contentType: string | null = null;
  let contentLength: number | null = null;

  try {
    const head = await fetchWithTimeout(candidateUrl, 10_000, {
      method: "HEAD",
      headers: { Accept: "application/pdf,*/*", Referer: referer },
    });
    contentType = head.headers.get("content-type");
    contentLength = Number(head.headers.get("content-length") || 0) || null;
    const cd = (head.headers.get("content-disposition") || "").toLowerCase();
    const ct = (contentType || "").toLowerCase();
    if (ct.includes("application/pdf") || cd.includes(".pdf")) {
      return { verified: true, contentType, contentLength };
    }
  } catch {
    // Fall through to a range sniff.
  }

  try {
    const range = await fetchWithTimeout(candidateUrl, 15_000, {
      method: "GET",
      headers: {
        Range: `bytes=0-${RANGE_SNIFF_BYTES}`,
        Accept: "application/pdf,*/*",
        Referer: referer,
      },
    });
    const ct = range.headers.get("content-type");
    const cd = (range.headers.get("content-disposition") || "").toLowerCase();
    contentType = ct || contentType;
    contentLength =
      Number(range.headers.get("content-length") || 0) || contentLength;

    const contentTypePdf = (ct || "").toLowerCase().includes("application/pdf");
    const dispositionPdf = cd.includes(".pdf");
    if (contentTypePdf || dispositionPdf) {
      return { verified: true, contentType, contentLength };
    }

    const len = Number(range.headers.get("content-length") || 0);
    if (range.status === 200 && len && len > 512 * 1024) {
      return {
        verified: looksLikePdfUrl(candidateUrl),
        contentType,
        contentLength: len,
      };
    }

    const buf = Buffer.from(await range.arrayBuffer());
    return {
      verified: isPdfMagic(buf),
      contentType,
      contentLength,
    };
  } catch {
    return {
      verified: looksLikePdfUrl(candidateUrl),
      contentType,
      contentLength,
    };
  }
}

function resolveChromiumExecutablePath(): string {
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    env.CHROMIUM_EXECUTABLE_PATH,
    ...DEFAULT_CHROMIUM_PATHS,
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH or PUPPETEER_EXECUTABLE_PATH.",
  );
}

async function launchBrowser(): Promise<Browser> {
  const opts: LaunchOptions = {
    headless: true,
    executablePath: resolveChromiumExecutablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-ipv6",
    ],
  };

  return puppeteer.launch(opts);
}

async function discoverWithBrowser(sourceUrl: string): Promise<RawCandidate[]> {
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(45_000);
    await page.setUserAgent(BROWSER_UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        const headers = resp.headers();
        const ct = String(headers["content-type"] || "").toLowerCase();
        const cd = String(headers["content-disposition"] || "").toLowerCase();
        const likely =
          ct.includes("application/pdf") ||
          cd.includes(".pdf") ||
          looksLikePdfUrl(url);
        if (!likely) return;
        const canonical = canonicalizeUrl(url) || url;
        if (seen.has(canonical)) return;
        seen.add(canonical);
        out.push({
          url,
          title: fileNameFromUrl(url),
          anchorText: null,
          contextText: null,
          method: "browser_network",
          rawMeta: { contentType: ct || null },
        });
      } catch {
        // ignore response collection issues
      }
    });

    await page.goto(sourceUrl, {
      waitUntil: "networkidle2",
      timeout: 45_000,
    } as any);
    await new Promise((r) => setTimeout(r, 1000));

    const html = await page.content();
    for (const c of extractStaticPdfCandidates(html, page.url() || sourceUrl)) {
      const canonical = canonicalizeUrl(c.url) || c.url;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      out.push({ ...c, method: "browser_dom" });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return out.slice(0, DISCOVERY_MAX_CANDIDATES);
}

function mergeCandidates(candidates: RawCandidate[]) {
  const byCanonical = new Map<string, RawCandidate>();
  for (const c of candidates) {
    const canonical = canonicalizeUrl(c.url) || c.url;
    const existing = byCanonical.get(canonical);
    if (!existing) {
      byCanonical.set(canonical, c);
      continue;
    }
    byCanonical.set(canonical, {
      ...existing,
      title: existing.title || c.title,
      anchorText: existing.anchorText || c.anchorText,
      contextText: existing.contextText || c.contextText,
      method:
        existing.method === "browser_network" ? existing.method : c.method,
      rawMeta: { ...(existing.rawMeta || {}), ...(c.rawMeta || {}) },
    });
  }
  return Array.from(byCanonical.values()).slice(0, DISCOVERY_MAX_CANDIDATES);
}

async function prepareCandidate(
  c: RawCandidate,
  opts: { sourceUrl: string; query?: string | null },
): Promise<VerifiedCandidate | null> {
  let verified = false;
  let contentType: string | null = null;
  let contentLength: number | null = null;

  try {
    const probe = await verifyPdfCandidate(c.url, opts.sourceUrl);
    verified = probe.verified;
    contentType = probe.contentType;
    contentLength = probe.contentLength;
  } catch {
    if (!looksLikePdfUrl(c.url)) return null;
  }

  if (!verified && !looksLikePdfUrl(c.url)) return null;

  const text = `${c.title || ""} ${c.anchorText || ""} ${
    c.contextText || ""
  } ${c.url}`;
  const date = parseDateHint(text);
  const score = scoreCandidate(c, { query: opts.query, verified });

  return {
    ...c,
    canonicalUrl: canonicalizeUrl(c.url) || c.url,
    title: titleFromCandidate(c),
    fileNameHint: fileNameFromUrl(c.url),
    contentType,
    contentLength,
    verified,
    score: score.score,
    confidence: score.confidence,
    dateHint: date.date,
    rawDateHint: date.raw,
  };
}

function serializeRow(row: any): DiscoveredPdfDocument {
  const activeCapturedFiles = Array.isArray(row.capturedFiles)
    ? row.capturedFiles.filter((f: any) => !f.deletedAt)
    : undefined;
  const hasActiveCapturedFiles = !!activeCapturedFiles?.length;

  return {
    id: row.id,
    sourceUrlId: row.sourceUrlId,
    discoveryRunId: row.discoveryRunId ?? null,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    anchorText: row.anchorText ?? null,
    contextText: row.contextText ?? null,
    dateHint: row.dateHint ? row.dateHint.toISOString() : null,
    rawDateHint: row.rawDateHint ?? null,
    fileNameHint: row.fileNameHint ?? null,
    contentType: row.contentType ?? null,
    contentLength: row.contentLength ?? null,
    verified: Boolean(row.verified),
    score: Number(row.score || 0),
    confidence: (row.confidence || "low") as any,
    discoveryMethod: row.discoveryMethod,
    status: hasActiveCapturedFiles ? row.status : "DISCOVERED",
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    capturedAt: hasActiveCapturedFiles
      ? row.capturedAt
        ? row.capturedAt.toISOString()
        : null
      : null,
    captureError: row.captureError ?? null,
    capturedFiles: hasActiveCapturedFiles
      ? activeCapturedFiles?.map((f: any) => ({
          id: f.id,
          fileName: f.fileName,
          createdAt: f.createdAt.toISOString(),
          sha256: f.sha256 ?? null,
        }))
      : undefined,
  };
}

function methodSummary(candidates: VerifiedCandidate[]) {
  return candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.method] = (acc[c.method] || 0) + 1;
    return acc;
  }, {});
}

async function persistVerifiedCandidates(input: {
  sourceUrlId: number;
  runId: string;
  candidates: VerifiedCandidate[];
}) {
  const rows = [];
  for (const c of input.candidates) {
    const row = await db().urlDiscoveredDocument.upsert({
      where: {
        sourceUrlId_canonicalUrl: {
          sourceUrlId: input.sourceUrlId,
          canonicalUrl: c.canonicalUrl,
        },
      },
      update: {
        discoveryRunId: input.runId,
        url: c.url,
        title: c.title,
        anchorText: c.anchorText ?? null,
        contextText: c.contextText ?? null,
        dateHint: c.dateHint,
        rawDateHint: c.rawDateHint,
        fileNameHint: c.fileNameHint,
        contentType: c.contentType,
        contentLength: c.contentLength,
        verified: c.verified,
        score: c.score,
        confidence: c.confidence,
        discoveryMethod: c.method,
        rawMeta: c.rawMeta ?? {},
      },
      create: {
        sourceUrlId: input.sourceUrlId,
        discoveryRunId: input.runId,
        url: c.url,
        canonicalUrl: c.canonicalUrl,
        title: c.title,
        anchorText: c.anchorText ?? null,
        contextText: c.contextText ?? null,
        dateHint: c.dateHint,
        rawDateHint: c.rawDateHint,
        fileNameHint: c.fileNameHint,
        contentType: c.contentType,
        contentLength: c.contentLength,
        verified: c.verified,
        score: c.score,
        confidence: c.confidence,
        discoveryMethod: c.method,
        status: "DISCOVERED",
        rawMeta: c.rawMeta ?? {},
      },
      include: {
        capturedFiles: {
          where: { deletedAt: null },
          select: {
            id: true,
            fileName: true,
            createdAt: true,
            sha256: true,
            deletedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    rows.push(row);
  }

  return rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

export async function discoverDocumentsForUrl(input: {
  sourceUrlId: number;
  query?: string | null;
  maxDepth?: number;
  useBrowserFallback?: boolean;
}) {
  const source = await prisma.url.findUnique({
    where: { id: input.sourceUrlId },
    select: { id: true, url: true, title: true },
  });

  if (!source) {
    const err: any = new Error("Saved URL not found.");
    err.status = 404;
    throw err;
  }

  const maxDepth = Math.max(1, Math.min(Number(input.maxDepth || 1), 2));
  const run = await db().urlDiscoveryRun.create({
    data: {
      sourceUrlId: source.id,
      sourcePageUrl: source.url,
      query: input.query || null,
      maxDepth,
      status: "RUNNING",
    },
  });

  try {
    const allowed = await isRobotsAllowed(source.url);
    if (!allowed) {
      const err: any = new Error("Blocked by robots.txt");
      err.status = 403;
      err.code = "ROBOTS_BLOCKED";
      throw err;
    }

    const rawCandidates: RawCandidate[] = [];
    const probe = await probeUrlKind(source.url).catch(() => null);

    if (probe?.kind === "pdf") {
      rawCandidates.push({
        url: probe.finalUrl || source.url,
        title: source.title || fileNameFromUrl(probe.finalUrl || source.url),
        anchorText: source.title,
        contextText: source.title,
        method: "direct_url",
        rawMeta: {
          contentType: probe.contentType,
          contentDisposition: probe.contentDisposition,
        },
      });
    } else {
      const html = await fetchHtml(source.url);
      rawCandidates.push(...extractStaticPdfCandidates(html, source.url));

      if (
        input.useBrowserFallback !== false &&
        rawCandidates.length < 3
      ) {
        try {
          rawCandidates.push(...(await discoverWithBrowser(source.url)));
        } catch (error: any) {
          log.info("pdf_discovery_browser_fallback_failed", {
            sourceUrlId: source.id,
            sourceUrl: source.url,
            error: String(error?.message || error),
          });
        }
      }
    }

    const merged = mergeCandidates(rawCandidates);
    const prepared: VerifiedCandidate[] = [];
    for (const c of merged) {
      const verified = await prepareCandidate(c, {
        sourceUrl: source.url,
        query: input.query,
      });
      if (verified) prepared.push(verified);
    }

    prepared.sort((a, b) => b.score - a.score);
    const rows = await persistVerifiedCandidates({
      sourceUrlId: source.id,
      runId: run.id,
      candidates: prepared,
    });

    const capturedCount = countRowsWithActiveCapturedFiles(rows);
    await db().urlDiscoveryRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        candidateCount: rows.length,
        verifiedCount: rows.filter((r) => r.verified).length,
        capturedCount,
        methodSummary: methodSummary(prepared),
        completedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      sourceUrlId: source.id,
      sourceUrl: source.url,
      documents: rows.map(serializeRow),
      summary: {
        discoveredCount: rows.length,
        capturedCount,
        verifiedCount: rows.filter((r) => r.verified).length,
        lastDiscoveredAt: new Date().toISOString(),
      } satisfies DiscoverySummary,
    };
  } catch (error: any) {
    await db().urlDiscoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: error?.code || null,
        errorMessage: String(error?.message || error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function listDiscoveredDocumentsForUrl(sourceUrlId: number) {
  const rows = await db().urlDiscoveredDocument.findMany({
    where: { sourceUrlId },
    orderBy: [{ score: "desc" }, { lastSeenAt: "desc" }],
    include: {
      capturedFiles: {
        where: { deletedAt: null },
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          sha256: true,
          deletedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return {
    sourceUrlId,
    documents: rows.map(serializeRow),
    summary: summarizeRows(rows),
  };
}

function hasActiveCapturedFile(row: any): boolean {
  return Array.isArray(row?.capturedFiles)
    ? row.capturedFiles.some((f: any) => !f?.deletedAt)
    : false;
}

function countRowsWithActiveCapturedFiles(rows: any[]): number {
  return rows.filter(hasActiveCapturedFile).length;
}

function summarizeRows(rows: any[]): DiscoverySummary {
  let lastDiscoveredAt: string | null = null;
  for (const row of rows) {
    const iso = row.lastSeenAt?.toISOString?.() ?? null;
    if (iso && (!lastDiscoveredAt || iso > lastDiscoveredAt)) {
      lastDiscoveredAt = iso;
    }
  }
  return {
    discoveredCount: rows.length,
    capturedCount: countRowsWithActiveCapturedFiles(rows),
    verifiedCount: rows.filter((r) => r.verified).length,
    lastDiscoveredAt,
  };
}

export async function getDiscoverySummariesByUrlId(
  sourceUrlIds: number[],
): Promise<Map<number, DiscoverySummary>> {
  const ids = Array.from(new Set(sourceUrlIds)).filter((id) =>
    Number.isFinite(id),
  );
  const out = new Map<number, DiscoverySummary>();
  ids.forEach((id) =>
    out.set(id, {
      discoveredCount: 0,
      capturedCount: 0,
      verifiedCount: 0,
      lastDiscoveredAt: null,
    }),
  );
  if (!ids.length) return out;

  const rows = await db().urlDiscoveredDocument.findMany({
    where: { sourceUrlId: { in: ids } },
    select: {
      sourceUrlId: true,
      verified: true,
      lastSeenAt: true,
      capturedFiles: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
  });

  for (const row of rows) {
    const summary =
      out.get(row.sourceUrlId) ||
      ({
        discoveredCount: 0,
        capturedCount: 0,
        verifiedCount: 0,
        lastDiscoveredAt: null,
      } satisfies DiscoverySummary);
    summary.discoveredCount += 1;
    if (row.verified) summary.verifiedCount += 1;
    if (row.capturedFiles.length > 0) {
      summary.capturedCount += 1;
    }
    const iso = row.lastSeenAt?.toISOString?.() ?? null;
    if (iso && (!summary.lastDiscoveredAt || iso > summary.lastDiscoveredAt)) {
      summary.lastDiscoveredAt = iso;
    }
    out.set(row.sourceUrlId, summary);
  }

  return out;
}

export async function markDiscoveredDocumentCaptured(input: {
  discoveredDocumentId: string;
  fileId: string;
}) {
  return db().urlDiscoveredDocument.update({
    where: { id: input.discoveredDocumentId },
    data: {
      status: "CAPTURED",
      capturedAt: new Date(),
      captureError: null,
    },
  });
}

export async function markDiscoveredDocumentCaptureFailed(input: {
  discoveredDocumentId: string;
  error: string;
}) {
  return db().urlDiscoveredDocument.update({
    where: { id: input.discoveredDocumentId },
    data: {
      status: "FAILED",
      captureError: input.error.slice(0, 1000),
    },
  });
}
