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

type PublishedAtMeta = {
  source:
    | "pdf_info"
    | "pdf_pages"
    | "pdf_text_heuristic"
    | "jsonld"
    | "html_meta"
    | "url_pattern"
    | "unknown";
  confidence: number; // 0..1
  details?: Record<string, any>;
};

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

function pickMetaContent(doc: Document, selectors: string[]) {
  for (const sel of selectors) {
    const v = doc.querySelector(sel)?.getAttribute("content");
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function looksLikePdfBytes(buf: Buffer) {
  // PDF header starts with "%PDF-"
  return buf.length >= 5 && buf.slice(0, 5).toString("utf8") === "%PDF-";
}

async function sniffIsPdfUrl(url: string): Promise<boolean> {
  // quick check: ".pdf" in path or query
  const u = new URL(url);
  const raw = `${u.pathname}${u.search}`.toLowerCase();
  if (raw.includes(".pdf")) return true;

  // fallback: HEAD content-type
  try {
    const resp = await axios.head(url, {
      timeout: 8000,
      headers: { "User-Agent": USER_AGENT },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    const ct = String(resp.headers?.["content-type"] || "").toLowerCase();
    return ct.includes("application/pdf");
  } catch {
    return false;
  }
}

function extractPublishedAtFromUrl(url: string): Date | null {
  // Try patterns like /2023/09/30/ or -2023-09-30-
  const m =
    url.match(/\/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\/|$)/) ||
    url.match(/(20\d{2})[\-_](\d{1,2})[\-_](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function tryParseDateLoose(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;

  // PDF info dates often look like: D:20220101123456+05'30'
  const m = t.match(/^D:(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return tryParseDate(t);
}

function guessPdfPublishedAtFromText(text: string): Date | null {
  const t = String(text || "");
  // Common signals: "Published on", "Publication date", "Date:" "Dated:"
  const rx =
    /(published\s+on|publication\s+date|dated)\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}|\d{4}\-\d{2}\-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

  const m = t.match(rx);
  if (!m) return null;

  const cand = m[2];
  // try parse with Date() for common forms, plus some normalization
  const d = new Date(cand);
  if (!Number.isNaN(d.getTime())) return d;

  // normalize dd/mm/yyyy
  const m2 = cand.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m2) {
    const dd = Number(m2[1]);
    const mm = Number(m2[2]);
    let yy = Number(m2[3]);
    if (yy < 100) yy += 2000;
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

function extractPdfDateCandidatesFromPages(
  pages: { pageNumber: number; text: string }[],
) {
  const candidates: { date: Date; score: number; pageNumber: number }[] = [];

  const addCandidate = (date: Date, score: number, pageNumber: number) => {
    if (Number.isNaN(date.getTime())) return;
    candidates.push({ date, score, pageNumber });
  };

  const datePatterns: Array<{
    rx: RegExp;
    weight: number;
    parse: (m: RegExpMatchArray) => Date | null;
  }> = [
    // 2021-12-31
    {
      rx: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
      weight: 0.7,
      parse: (m) =>
        new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
    },
    // dd/mm/yyyy
    {
      rx: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g,
      weight: 0.6,
      parse: (m) => {
        let yy = Number(m[3]);
        if (yy < 100) yy += 2000;
        return new Date(Date.UTC(yy, Number(m[2]) - 1, Number(m[1])));
      },
    },
    // 31 March 2022
    {
      rx: /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/gi,
      weight: 0.85,
      parse: (m) => {
        const monthMap: Record<string, number> = {
          jan: 0,
          january: 0,
          feb: 1,
          february: 1,
          mar: 2,
          march: 2,
          apr: 3,
          april: 3,
          may: 4,
          jun: 5,
          june: 5,
          jul: 6,
          july: 6,
          aug: 7,
          august: 7,
          sep: 8,
          sept: 8,
          september: 8,
          oct: 9,
          october: 9,
          nov: 10,
          november: 10,
          dec: 11,
          december: 11,
        };
        const dd = Number(m[1]);
        const mm = monthMap[m[2].toLowerCase()] ?? 0;
        const yy = Number(m[3]);
        return new Date(Date.UTC(yy, mm, dd));
      },
    },
  ];

  const contextBoost = (ctx: string) => {
    const c = ctx.toLowerCase();
    if (/(published|publication|approved|dated|issued)\b/.test(c)) return 0.6;
    if (/(annual report|report|statement)\b/.test(c)) return 0.25;
    return 0;
  };

  for (const p of pages) {
    const text = String(p.text || "");
    const lower = text.toLowerCase();

    // Use a small window around matches to detect context words
    for (const pat of datePatterns) {
      let m: RegExpExecArray | null;
      const rx = new RegExp(pat.rx.source, pat.rx.flags); // reset
      while ((m = rx.exec(text))) {
        const raw = m[0];
        const start = Math.max(0, m.index - 40);
        const end = Math.min(text.length, m.index + raw.length + 40);
        const ctx = text.slice(start, end);

        const parsed = pat.parse(m as any);
        if (!parsed) continue;

        // score = base weight + context + position heuristic
        // prefer later pages slightly (dates often on last page)
        const pagePos = pages.length ? p.pageNumber / pages.length : 0;
        const posBoost = pagePos > 0.8 ? 0.25 : pagePos > 0.5 ? 0.1 : 0;

        const score = pat.weight + contextBoost(ctx) + posBoost;

        // filter out likely junk like far future dates
        const year = parsed.getUTCFullYear();
        if (year < 1990 || year > 2100) continue;

        // avoid capturing "financial year 2021-22" as 2021-22 date
        if (lower.includes("fy") || lower.includes("financial year")) {
          // but still allow if there's strong "published/approved"
          if (contextBoost(ctx) < 0.5) continue;
        }

        addCandidate(parsed, score, p.pageNumber);
      }
    }
  }

  return candidates;
}

async function extractPdfPagesFromBuffer(buf: Buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdfDoc = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];
  const totalPages = pdfDoc.numPages;

  for (let i = 1; i <= totalPages; i++) {
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
  publishedAtMeta: PublishedAtMeta;
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
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
    };
  }

  if (resp.status >= 400) {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
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
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
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
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
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

  let publishedAt: Date | null = null;
  let publishedAtMeta: PublishedAtMeta = { source: "unknown", confidence: 0.0 };

  const infoParsed = tryParseDateLoose(infoDate);
  if (infoParsed) {
    publishedAt = infoParsed;
    publishedAtMeta = {
      source: "pdf_info",
      confidence: 0.55,
      details: { field: out?.info?.CreationDate ? "CreationDate" : "ModDate" },
    };
  } else {
    const fromPages = pickBestPublishedAtFromPdfPages(pages);
    if (fromPages) {
      publishedAt = fromPages;
      publishedAtMeta = {
        source: "pdf_pages",
        confidence: 0.85,
        details: { totalPages: pages.length },
      };
    } else {
      const heuristic = guessPdfPublishedAtFromText(text);
      if (heuristic) {
        publishedAt = heuristic;
        publishedAtMeta = { source: "pdf_text_heuristic", confidence: 0.5 };
      } else {
        const urlDate = extractPublishedAtFromUrl(url);
        publishedAt = urlDate;
        publishedAtMeta = urlDate
          ? { source: "url_pattern", confidence: 0.35 }
          : { source: "unknown", confidence: 0.0 };
      }
    }
  }

  const snippet = cleaned.slice(0, PREVIEW_SNIPPET_CHARS);

  return { title, snippet, authors, publishedAt, publishedAtMeta };
}

export async function extractUrlMetadata(url: string): Promise<{
  title: string;
  snippet: string;
  authors: string[];
  publishedAt: Date | null;
  publishedAtMeta: PublishedAtMeta;
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
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
    };
  }

  // Paywall/login/blocked → don't throw, just return safe fallback
  if (resp.status >= 400) {
    return {
      title: url,
      snippet: "",
      authors: [],
      publishedAt: extractPublishedAtFromUrl(url),
      publishedAtMeta: { source: "url_pattern", confidence: 0.35 },
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

  // publishedAt: JSON-LD first; fallback to meta tags; fallback to URL pattern
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

  let publishedAt: Date | null = null;
  let publishedAtMeta: PublishedAtMeta = { source: "unknown", confidence: 0.0 };

  if (publishedLd) {
    publishedAt = publishedLd;
    publishedAtMeta = { source: "jsonld", confidence: 0.85 };
  } else {
    const metaParsed = tryParseDate(metaPublished);
    if (metaParsed) {
      publishedAt = metaParsed;
      publishedAtMeta = {
        source: "html_meta",
        confidence: 0.65,
        details: { raw: metaPublished || null },
      };
    } else {
      const urlDate = extractPublishedAtFromUrl(url);
      publishedAt = urlDate;
      publishedAtMeta = urlDate
        ? { source: "url_pattern", confidence: 0.35 }
        : { source: "unknown", confidence: 0.0 };
    }
  }

  return { title, snippet, authors, publishedAt, publishedAtMeta };
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
    const strings = (content.items as any[])
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);
    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }
  return pages;
}

export function detectScannedPdf(
  pages: { pageNumber: number; text: string }[],
): {
  pageCount: number;
  totalChars: number;
  avgCharsPerPage: number;
  nonEmptyPages: number;
  nonEmptyRatio: number;
  avgWordsPerPage: number;
  isScannedLikely: boolean;
  thresholdCharsPerPage: number;
  thresholdNonEmptyRatio: number;
} {
  const pageCount = pages.length;

  const normalized = pages.map((p) => String(p.text || "").trim());

  const totalChars = normalized.reduce(
    (sum, text) => sum + text.replace(/\s+/g, "").length,
    0,
  );

  const totalWords = normalized.reduce((sum, text) => {
    if (!text) return sum;
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);

  const nonEmptyPages = normalized.filter((text) => text.length > 0).length;

  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0;
  const avgWordsPerPage = pageCount > 0 ? totalWords / pageCount : 0;
  const nonEmptyRatio = pageCount > 0 ? nonEmptyPages / pageCount : 0;

  const thresholdCharsPerPage = 20;
  const thresholdNonEmptyRatio = 0.5;

  const isScannedLikely =
    pageCount > 0 &&
    (avgCharsPerPage < thresholdCharsPerPage ||
      nonEmptyRatio < thresholdNonEmptyRatio);

  return {
    pageCount,
    totalChars,
    avgCharsPerPage,
    nonEmptyPages,
    nonEmptyRatio,
    avgWordsPerPage,
    isScannedLikely,
    thresholdCharsPerPage,
    thresholdNonEmptyRatio,
  };
}

// ---------- File metadata extraction helpers (used by other services) ----------

export async function extractTextFromStoredFile(
  storagePath: string,
  mimeType: string,
) {
  return extractTextFromFile(storagePath, mimeType);
}

export async function extractSnippetFromStoredFile(
  storagePath: string,
  mimeType: string,
) {
  const text = await extractTextFromFile(storagePath, mimeType);
  const cleaned = cleanSnippet(text);
  return cleaned.slice(0, PREVIEW_SNIPPET_CHARS);
}

export async function extractTitleFromStoredFile(
  storagePath: string,
  mimeType: string,
) {
  const text = await extractTextFromFile(storagePath, mimeType);
  const cleaned = cleanSnippet(text);
  const titleFromText =
    cleaned
      .split(/\n|\.|\|/)
      .map((x) => x.trim())
      .find(Boolean) || "";
  return titleFromText || path.basename(storagePath);
}

export async function extractFileMetadata(
  storagePath: string,
  mimeType: string,
): Promise<{ title: string; snippet: string }> {
  const title = await extractTitleFromStoredFile(storagePath, mimeType);
  const snippet = await extractSnippetFromStoredFile(storagePath, mimeType);
  return { title, snippet };
}
