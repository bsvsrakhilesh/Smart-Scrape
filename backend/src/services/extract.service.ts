import axios from "axios";
import { readFile } from "fs/promises";
import * as path from "path";
import { createDom } from "../utils/dom";
import { Readability } from "@mozilla/readability";
import pdf from "pdf-parse";
import dns from "dns/promises";
import net from "net";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs/promises";

const MAX_HTML_BYTES = Number(
  process.env.EXTRACT_MAX_HTML_BYTES || 10 * 1024 * 1024,
);
const PREVIEW_SNIPPET_CHARS = Number(process.env.EXTRACT_PREVIEW_CHARS || 260);
const USER_AGENT = process.env.EXTRACT_USER_AGENT || "SmartScrapeBot/1.0";
const URL_METADATA_TIMEOUT_MS = Number(
  process.env.EXTRACT_URL_TIMEOUT_MS || 30000,
);

function ipv4ToInt(ip: string) {
  const parts = ip.split(".").map((x) => Number(x));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)
  )
    return null;
  return (
    ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  );
}

function isPrivateIp(ip: string) {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;

    const inRange = (a: string, b: string) => {
      const na = ipv4ToInt(a)!;
      const nb = ipv4ToInt(b)!;
      return n >= na && n <= nb;
    };

    return (
      inRange("10.0.0.0", "10.255.255.255") || // 10/8
      inRange("172.16.0.0", "172.31.255.255") || // 172.16/12
      inRange("192.168.0.0", "192.168.255.255") || // 192.168/16
      inRange("127.0.0.0", "127.255.255.255") || // loopback
      inRange("169.254.0.0", "169.254.255.255") || // link-local
      inRange("0.0.0.0", "0.255.255.255") // "this network"
    );
  }

  if (family === 6) {
    const t = ip.toLowerCase();
    return (
      t === "::1" || // loopback
      t.startsWith("fc") ||
      t.startsWith("fd") || // fc00::/7 unique local
      t.startsWith("fe8") ||
      t.startsWith("fe9") ||
      t.startsWith("fea") ||
      t.startsWith("feb") // fe80::/10 link-local (approx)
    );
  }

  // Not a valid IP string => treat as unsafe if we ever get here.
  return true;
}

async function assertSafeUrl(rawUrl: string) {
  const u = new URL(rawUrl);

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

  const host = (u.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) {
    throw new Error("Blocked hostname");
  }

  // DNS resolve and block private/internal IPs (SSRF protection)
  const addrs = await dns.lookup(host, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Blocked private/internal IP");
    }
  }
}

function cleanSnippet(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

export async function extractTextFromUrl(url: string): Promise<string> {
  await assertSafeUrl(url);

  const { data: html } = await axios.get<string>(url, {
    timeout: 15000,
    responseType: "text",
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    headers: { "User-Agent": USER_AGENT },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const dom = createDom(html, url);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title || dom.window.document.title || "";
  const text =
    article?.textContent || dom.window.document.body?.textContent || "";
  return `${title}\n\n${text}`.trim();
}

function tryParseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;

  // handle ISO / RFC / common formats
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d;

  // sometimes JSON-LD has "2024-01-01T..." etc; Date() already covers most.
  return null;
}

function uniqNonEmpty(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of arr) {
    const t = String(a || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function extractLdJson(dom: any): any[] {
  const nodes = Array.from(
    dom.window.document.querySelectorAll('script[type="application/ld+json"]'),
  );

  const out: any[] = [];
  for (const n of nodes) {
    const txt = (n as any)?.textContent || "";
    if (!txt.trim()) continue;
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignore invalid json-ld blocks
    }
  }
  return out;
}

function pickAuthorsFromLd(ld: any[]): string[] {
  const authors: string[] = [];

  const pushAuthor = (a: any) => {
    if (!a) return;
    if (typeof a === "string") authors.push(a);
    else if (Array.isArray(a)) a.forEach(pushAuthor);
    else if (typeof a === "object") {
      // common JSON-LD shapes
      if (typeof a.name === "string") authors.push(a.name);
      else if (typeof a["@name"] === "string") authors.push(a["@name"]);
    }
  };

  for (const obj of ld) {
    if (!obj || typeof obj !== "object") continue;

    // some sites wrap actual article inside @graph
    const graph = Array.isArray(obj["@graph"]) ? obj["@graph"] : null;
    const targets = graph ? graph : [obj];

    for (const t of targets) {
      if (!t || typeof t !== "object") continue;
      pushAuthor((t as any).author);
      pushAuthor((t as any).creator);
    }
  }

  return uniqNonEmpty(authors);
}

function pickPublishedFromLd(ld: any[]): Date | null {
  const candidates: Array<string | null | undefined> = [];

  for (const obj of ld) {
    if (!obj || typeof obj !== "object") continue;

    const graph = Array.isArray(obj["@graph"]) ? obj["@graph"] : null;
    const targets = graph ? graph : [obj];

    for (const t of targets) {
      if (!t || typeof t !== "object") continue;
      candidates.push((t as any).datePublished);
      candidates.push((t as any).dateCreated);
      candidates.push((t as any).dateModified);
    }
  }

  for (const c of candidates) {
    const d = tryParseDate(c);
    if (d) return d;
  }
  return null;
}

function pickMetaContent(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const v = el?.getAttribute("content");
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export async function extractUrlMetadata(url: string): Promise<{
  title: string;
  snippet: string;
  authors: string[];
  publishedAt: Date | null;
}> {
  await assertSafeUrl(url);

  const { data: html } = await axios.get<string>(url, {
    timeout: URL_METADATA_TIMEOUT_MS,
    responseType: "text",
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    headers: { "User-Agent": USER_AGENT },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const dom = createDom(html, url);
  const doc = dom.window.document;

  const ogTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ||
    "";

  const reader = new Readability(doc);
  const article = reader.parse();

  const title = (article?.title || ogTitle || doc.title || url).trim();

  const rawText = article?.textContent || doc.body?.textContent || "";
  const snippet = cleanSnippet(rawText).slice(0, PREVIEW_SNIPPET_CHARS);

  // -------- authors & publishedAt --------
  const ld = extractLdJson(dom);

  // authors: JSON-LD first; fallback to meta tags; fallback to Readability byline
  const authorsLd = pickAuthorsFromLd(ld);
  const metaAuthor = pickMetaContent(doc, [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="parsely-author"]',
    'meta[name="dc.creator"]',
    'meta[name="DC.creator"]',
  ]);

  const byline =
    typeof (article as any)?.byline === "string" ? (article as any).byline : "";

  const authors = uniqNonEmpty([
    ...authorsLd,
    ...(metaAuthor ? [metaAuthor] : []),
    ...(byline ? [byline] : []),
  ]);

  // publishedAt: JSON-LD first; fallback to meta tags
  const publishedLd = pickPublishedFromLd(ld);

  const metaPublished = pickMetaContent(doc, [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'meta[name="DC.date"]',
    'meta[name="dc.date"]',
  ]);

  const publishedAt = publishedLd || tryParseDate(metaPublished);

  return { title, snippet, authors, publishedAt };
}

export async function extractPreviewFromUrl(
  url: string,
): Promise<{ title: string; snippet: string }> {
  const { title, snippet } = await extractUrlMetadata(url);
  return { title, snippet };
}

export async function extractTextFromFile(
  filePath: string,
  mimeType: string,
): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType?.startsWith("text/") || ext === ".txt") {
    try {
      return (await readFile(filePath, "utf8")).toString();
    } catch {
      /* fallthrough */
    }
  }
  if (ext === ".pdf" || mimeType === "application/pdf") {
    const buf = await readFile(filePath);
    const out = await pdf(buf);
    return out.text || "";
  }
  try {
    return (await readFile(filePath, "utf8")).toString();
  } catch {
    return "";
  }
}

export async function extractPdfPagesFromFile(
  storagePath: string,
): Promise<{ pageNumber: number; text: string }[]> {
  const buf = await fs.readFile(storagePath);
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Join items in reading order (good enough for v1)
    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return pages;
}

export function detectScannedPdf(
  pages: { pageNumber: number; text: string }[],
) {
  const pageCount = pages.length || 0;
  const totalChars = pages.reduce(
    (acc, p) => acc + (p.text?.trim().length || 0),
    0,
  );
  const avgCharsPerPage = pageCount ? totalChars / pageCount : 0;

  // Heuristic thresholds:
  // - scanned PDFs often yield ~0–30 chars per page in pdf-parse/page extractors
  // - real text PDFs usually have hundreds/thousands of chars per page
  const isScannedLikely = totalChars < 200 || avgCharsPerPage < 40;

  return {
    pageCount,
    totalChars,
    avgCharsPerPage,
    isScannedLikely,
  };
}
