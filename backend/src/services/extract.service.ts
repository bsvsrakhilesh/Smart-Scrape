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
const MAX_PDF_BYTES = Number(
  process.env.EXTRACT_MAX_PDF_BYTES || 20 * 1024 * 1024,
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

function tryParseDateLoose(s: string | null | undefined): Date | null {
  const d = tryParseDate(s);
  if (d) return d;

  const t = String(s || "").trim();
  if (!t) return null;

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy (day-first)
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy = yy + 2000;
    if (
      dd >= 1 &&
      dd <= 31 &&
      mm >= 1 &&
      mm <= 12 &&
      yy >= 1900 &&
      yy <= 2100
    ) {
      // use UTC to avoid TZ shifts
      return new Date(Date.UTC(yy, mm - 1, dd));
    }
  }

  return null;
}

function extractPublishedAtFromUrl(rawUrl: string): Date | null {
  try {
    const u = new URL(rawUrl);

    // 1) Look for ISO YYYY-MM-DD in ANY query param value (dt=2020-01-13, date=..., published=...)
    for (const [, v] of u.searchParams.entries()) {
      const t = String(v || "").trim();
      const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const yy = Number(m[1]);
        const mm = Number(m[2]);
        const dd = Number(m[3]);
        if (
          yy >= 1900 &&
          yy <= 2100 &&
          mm >= 1 &&
          mm <= 12 &&
          dd >= 1 &&
          dd <= 31
        ) {
          return new Date(Date.UTC(yy, mm - 1, dd));
        }
      }
      // also allow dd-mm-yyyy etc if present in params
      const loose = tryParseDateLoose(t);
      if (loose) return loose;
    }

    // 2) Look for YYYY-MM-DD / YYYY/MM/DD anywhere in the URL string
    const all = rawUrl;
    const m2 = all.match(/\b(\d{4})[\/-](\d{2})[\/-](\d{2})\b/);
    if (m2) {
      const yy = Number(m2[1]);
      const mm = Number(m2[2]);
      const dd = Number(m2[3]);
      if (
        yy >= 1900 &&
        yy <= 2100 &&
        mm >= 1 &&
        mm <= 12 &&
        dd >= 1 &&
        dd <= 31
      ) {
        return new Date(Date.UTC(yy, mm - 1, dd));
      }
    }

    return null;
  } catch {
    return null;
  }
}

function looksLikePdfBytes(buf: Buffer): boolean {
  // PDF files start with "%PDF-"
  if (!buf || buf.length < 5) return false;
  return (
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46 && // F
    buf[4] === 0x2d // -
  );
}

async function sniffIsPdfUrl(url: string): Promise<boolean> {
  // Cheap signals (also handle wrappers like ?filename=...pdf)
  const u = url.toLowerCase();
  if (u.includes(".pdf") || /[?&]filename=[^&]*\.pdf\b/.test(u)) return true;

  // HEAD is best-effort: some servers block it; we ignore errors
  try {
    const head = await axios.head(url, {
      timeout: Math.min(URL_METADATA_TIMEOUT_MS, 10000),
      headers: { "User-Agent": USER_AGENT },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    const ct = String(head.headers?.["content-type"] || "").toLowerCase();
    return ct.includes("application/pdf");
  } catch {
    return false;
  }
}

function guessPdfPublishedAtFromText(text: string): Date | null {
  const t = text.replace(/\s+/g, " ");

  // Common govt/legal patterns: "Dated: 03-03-2026", "Dated 3 March 2026"
  const m1 = t.match(
    /\bdated\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/i,
  );
  if (m1) return tryParseDateLoose(m1[1]);

  const m2 = t.match(/\bdated\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i);
  if (m2) return tryParseDateLoose(m2[1]);

  return null;
}

function extractPdfDateCandidatesFromPages(
  pages: { pageNumber: number; text: string }[],
) {
  const totalPages = pages.length || 0;

  const re =
    /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g;

  const out: Array<{
    date: Date;
    pageNumber: number;
    score: number;
    raw: string;
  }> = [];

  for (const p of pages) {
    const text = p.text || "";
    if (!text) continue;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1];
      const d = tryParseDateLoose(raw);
      if (!d) continue;

      const tl = text.toLowerCase();
      const matchIndex = m.index;

      // Context window around match
      const start = Math.max(0, matchIndex - 80);
      const end = Math.min(text.length, matchIndex + 80);
      const ctx = tl.slice(start, end);

      let score = 0;

      // Prefer last pages (govt notifications often sign/date at end)
      const pos = totalPages ? p.pageNumber / totalPages : 0;
      if (pos >= 0.85) score += 40;
      else if (pos >= 0.7) score += 25;
      else if (pos >= 0.5) score += 10;

      // Strong “this is the issuance date” signals
      if (ctx.includes("dated")) score += 60;
      if (ctx.includes("date:")) score += 35;
      if (ctx.includes("notification")) score += 15;
      if (ctx.includes("order")) score += 10;

      // Signature/location blocks near official date
      if (ctx.includes("new delhi")) score += 12;
      if (ctx.includes("registrar")) score += 10;
      if (ctx.includes("secretary")) score += 10;
      if (ctx.includes("by order")) score += 10;

      // Penalize “timeline / hearing / petition” dates (often not publish date)
      if (ctx.includes("hearing")) score -= 15;
      if (ctx.includes("petition")) score -= 15;
      if (ctx.includes("writ")) score -= 10;
      if (ctx.includes("judgment")) score -= 10;

      out.push({ date: d, pageNumber: p.pageNumber, score, raw });
    }
  }

  return out;
}

async function extractPdfPagesFromBuffer(
  buf: Buffer,
): Promise<{ pageNumber: number; text: string }[]> {
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdfDoc = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();

    const strings = (content.items as any[])
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return pages;
}

function pickBestPublishedAtFromPdfPages(
  pages: { pageNumber: number; text: string }[],
): Date | null {
  const cands = extractPdfDateCandidatesFromPages(pages);
  if (!cands.length) return null;

  // Best score wins; if tie, prefer latest date
  cands.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.date.getTime() - a.date.getTime();
  });

  return cands[0].date;
}

async function extractPdfUrlMetadata(url: string): Promise<{
  title: string;
  snippet: string;
  authors: string[];
  publishedAt: Date | null;
}> {
  let resp: any;
  try {
    resp = await axios.get<ArrayBuffer>(url, {
      timeout: URL_METADATA_TIMEOUT_MS,
      responseType: "arraybuffer",
      maxContentLength: MAX_PDF_BYTES,
      maxBodyLength: MAX_PDF_BYTES,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: (s) => s >= 200 && s < 500,
    });
  } catch {
    // Network/DNS/timeout/etc -> never throw up to controller
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }

  if (resp.status >= 400) {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }

  const buf = Buffer.from(resp.data);

  const ct = String(resp.headers?.["content-type"] || "").toLowerCase();

  const isPdf = ct.includes("application/pdf") || looksLikePdfBytes(buf);
  if (!isPdf) {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }

  // pdf-parse gives you text + some metadata in many cases
  let out: any;
  try {
    out = await pdf(buf);
  } catch {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }
  const text = String(out?.text || "");
  const cleaned = cleanSnippet(text);

  const infoTitle = String(out?.info?.Title || "").trim();
  const titleFromText =
    cleaned
      .split(/\n|\.|\|/)
      .map((x) => x.trim())
      .find(Boolean) || "";
  const title = (infoTitle || titleFromText || url).trim();

  const infoAuthor = String(out?.info?.Author || "").trim();
  const authors = uniqNonEmpty([...(infoAuthor ? [infoAuthor] : [])]);

  const infoDate = String(
    out?.info?.CreationDate || out?.info?.ModDate || "",
  ).trim();

  let pages: { pageNumber: number; text: string }[] = [];
  try {
    pages = await extractPdfPagesFromBuffer(buf);
  } catch {
    pages = [];
  }

  const publishedAt =
    tryParseDateLoose(infoDate) ||
    pickBestPublishedAtFromPdfPages(pages) ||
    guessPdfPublishedAtFromText(text) ||
    null;

  const snippet = cleaned.slice(0, PREVIEW_SNIPPET_CHARS);

  return { title, snippet, authors, publishedAt };
}

export async function extractUrlMetadata(url: string): Promise<{
  title: string;
  snippet: string;
  authors: string[];
  publishedAt: Date | null;
}> {
  await assertSafeUrl(url);

  // If it's a PDF URL, try PDF extraction, but never let it bubble into 502
  try {
    if (await sniffIsPdfUrl(url)) {
      return await extractPdfUrlMetadata(url);
    }
  } catch {
    // fallthrough to HTML path
  }

  let resp: any;
  try {
    resp = await axios.get<string>(url, {
      timeout: URL_METADATA_TIMEOUT_MS,
      responseType: "text",
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES,
      headers: { "User-Agent": USER_AGENT },
      // accept 4xx so we can return graceful fallback instead of throwing
      validateStatus: (s) => s >= 200 && s < 500,
    });
  } catch {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }

  // Paywall/login/blocked → don't throw, just return safe fallback
  if (resp.status >= 400) {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
    };
  }

  const html = resp.data;

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
