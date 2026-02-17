// backend/src/controllers/crawl.controller.ts
import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/database";
import { ensureDocumentRevisionForStoredFile } from "../services/document.service";
import { recordCaptureEvent } from "../services/provenance.service";
import { createDom } from "../utils/dom";
import { Readability } from "@mozilla/readability";
import puppeteer, { Browser, LaunchOptions, Page } from "puppeteer";
import pdfParse from "pdf-parse";
import { scheduleAiTagForFile } from "../services/aiTagAuto.service";
import dns from "node:dns/promises";
import * as ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { log, requestMeta } from "../utils/logger";
import { setReadableContentOnPage, hardenLivePage } from "../utils/reader";

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
      const err = new Error("SSRF denied: private/metadata IP");
      (err as any).status = 422;
      throw err;
    }
  }
}

async function fetchWithTimeout(
  url: string,
  ms = 10000,
  headers: Record<string, string> = {},
) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "SmartScrape/1.0", ...headers },
    });
    return res;
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
  // Some servers prepend whitespace or junk; scan first 1KB for "%PDF-"
  const max = Math.min(buf.length - 5, 1024);
  for (let i = 0; i <= max; i++) {
    if (
      buf[i] === 0x25 && // %
      buf[i + 1] === 0x50 && // P
      buf[i + 2] === 0x44 && // D
      buf[i + 3] === 0x46 && // F
      buf[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

function looksLikePdfUrl(u: URL) {
  const p = u.pathname.toLowerCase();
  if (p.endsWith(".pdf")) return true;

  // common govt patterns: ?filename=...pdf or any param containing .pdf
  for (const [, v] of u.searchParams.entries()) {
    const s = String(v || "").toLowerCase();
    if (s.includes(".pdf")) return true;
  }
  return false;
}

function derivePdfNameFromUrl(u: URL): string {
  for (const [, v] of u.searchParams.entries()) {
    const s = String(v || "");
    if (s.toLowerCase().includes(".pdf")) {
      const base = s.split("/").pop() || "document.pdf";
      return decodeURIComponent(base);
    }
  }
  const base = u.pathname.split("/").pop() || "document.pdf";
  return decodeURIComponent(base);
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function resolveWrappedPdfToDirect(u: URL): string | null {
  // Handles wrappers like:
  // https://api.sci.gov.in/pdfdate/index1.php?filename=supremecourt/.../x.pdf&...
  // -> https://api.sci.gov.in/supremecourt/.../x.pdf
  const fn = u.searchParams.get("filename");
  if (!fn) return null;

  const decoded = decodeURIComponent(fn).trim();
  if (/^https?:\/\//i.test(decoded)) return decoded;

  const cleaned = decoded.replace(/^\/+/, "");
  if (!cleaned.toLowerCase().includes(".pdf")) return null;

  return `${u.origin}/${cleaned}`;
}

function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;

  const mStar = cd.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (mStar?.[2]) {
    try {
      return decodeURIComponent(mStar[2].trim().replace(/^"|"$/g, ""));
    } catch {
      return mStar[2].trim().replace(/^"|"$/g, "");
    }
  }

  const m = cd.match(/filename\s*=\s*("?)([^";]+)\1/i);
  if (m?.[2]) return m[2].trim();

  return null;
}

function bestPdfFileName(u: URL, contentDisposition: string | null) {
  const fromCd = filenameFromContentDisposition(contentDisposition);
  const fromUrl = derivePdfNameFromUrl(u);
  const raw = fromCd || fromUrl || "document.pdf";
  return raw.toLowerCase().endsWith(".pdf") ? raw : `${raw}.pdf`;
}

// ===================== Storage helpers =====================
const STORAGE_DIR =
  process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "storage");
const FILES_DIR = path.join(STORAGE_DIR, "files");

function ensureDirs() {
  if (!fs.existsSync(STORAGE_DIR))
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 200) || "capture";
}

function newId() {
  return crypto.randomBytes(12).toString("hex"); // String id (matches typical Prisma cuid() style)
}

function inferMime(fileName: string, fallback?: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return fallback || "application/octet-stream";
}

type CaptureMeta = {
  method:
    | "direct_fetch"
    | "dom_candidate_fetch"
    | "puppeteer_intercept"
    | "page_print";
  capturedUrl?: string;
  contentType?: string | null;
  contentDisposition?: string | null;
  bytes?: number;
  notes?: string;
};

async function cookieHeaderFor(
  page: any,
  targetUrl: string,
): Promise<string | null> {
  try {
    const cookies = await page.cookies(targetUrl);
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
}

async function extractPdfCandidates(
  page: any,
  baseUrl: string,
): Promise<string[]> {
  try {
    const raw: string[] = await page.evaluate(() => {
      const out: string[] = [];
      const push = (u: any) => {
        if (!u || typeof u !== "string") return;
        const s = u.trim();
        if (!s) return;
        // ignore huge inline data URIs
        if (s.startsWith("data:")) return;
        out.push(s);
      };

      // obvious embeds
      document.querySelectorAll("iframe, embed, object").forEach((el: any) => {
        push(el.src);
        push(el.data);
      });

      // anchors + links with pdf-ish hints
      document.querySelectorAll("a[href], link[href]").forEach((el: any) => {
        const href = el.getAttribute("href");
        if (!href) return;
        const t = (el.textContent || "").toLowerCase();
        const h = href.toLowerCase();
        if (
          h.includes(".pdf") ||
          h.includes("pdf") ||
          t.includes("pdf") ||
          t.includes("download")
        ) {
          push(href);
        }
      });

      // pdf.js viewer patterns: ?file=... or #file=...
      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.search);
      const file = params.get("file") || params.get("pdf");
      if (file) push(file);
      const hash = String(url.hash || "");
      const m = hash.match(/(?:^|[?#&])file=([^&]+)/i);
      if (m && m[1]) push(decodeURIComponent(m[1]));

      return Array.from(new Set(out));
    });

    const abs = raw
      .map((u) => {
        try {
          return new URL(u, baseUrl).toString();
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];

    // keep only http(s)
    return abs.filter(
      (u) => u.startsWith("http://") || u.startsWith("https://"),
    );
  } catch {
    return [];
  }
}

async function downloadPdfWithHeaders(
  targetUrl: string,
  opts: { referer?: string; cookie?: string | null },
): Promise<{ bytes: Buffer; cd: string | null; ct: string | null } | null> {
  try {
    const resp = await fetchWithTimeout(targetUrl, 90_000, {
      Accept: "application/pdf,*/*",
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
      ...(opts.referer ? { Referer: opts.referer } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    });

    if (!resp.ok) return null;

    const ct = resp.headers.get("content-type");
    const cd = resp.headers.get("content-disposition");
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (!bytes || bytes.length < 1024) return null;
    if (!isPdfMagic(bytes)) return null;

    return { bytes, cd, ct };
  } catch {
    return null;
  }
}

async function tryClickPdfDownload(page: any): Promise<boolean> {
  try {
    const clicked = await page.evaluate(() => {
      const score = (el: Element) => {
        const t = (el.textContent || "").toLowerCase();
        const href = (el as any).href
          ? String((el as any).href).toLowerCase()
          : "";
        let s = 0;
        if (t.includes("pdf")) s += 3;
        if (t.includes("download")) s += 2;
        if (href.includes(".pdf")) s += 4;
        if (href.includes("pdf")) s += 1;
        return s;
      };

      const candidates: Element[] = Array.from(
        document.querySelectorAll("a, button, [role='button']"),
      );

      candidates.sort((a, b) => score(b) - score(a));
      const best = candidates.find((el) => score(el) >= 4);
      if (!best) return false;

      // force same-tab navigation when possible
      if ((best as any).setAttribute) {
        try {
          (best as any).setAttribute("target", "_self");
        } catch {}
      }

      (best as any).click?.();
      return true;
    });

    return Boolean(clicked);
  } catch {
    return false;
  }
}

async function persistFile(
  data: Buffer | Uint8Array,
  fileName: string,
  description: string,
  folderId?: string | null,
  meta?: {
    captureType?: "UPLOAD" | "URL_TEXT" | "URL_PDF";
    sourceUrl?: string | null;
    urlId?: number | null;
    requestId?: string | null;
    captureMeta?: CaptureMeta | null;
  },
) {
  ensureDirs();
  const id = newId();
  const safeName = sanitizeName(fileName);
  const storagePath = path.join(FILES_DIR, `${id}__${safeName}`);

  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  fs.writeFileSync(storagePath, buf);

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const rec = await prisma.storedFile.create({
    data: {
      id,
      fileName: safeName,
      description,
      size: buf.byteLength,
      mimeType: inferMime(safeName),
      storagePath,
      uploaderId: "self",
      uploaderName: "You",
      folderId: folderId ? String(folderId) : null,
      isFavorited: false,

      // new fields
      captureType: (meta?.captureType as any) ?? "UPLOAD",
      sourceUrl: meta?.sourceUrl ?? null,
      sha256,
      contentHash: sha256,
      urlId: meta?.urlId ?? null,

      // keep capture diagnostics (UI can show where bytes came from)
      tagsMeta: meta?.captureMeta
        ? ({ capture: meta.captureMeta } as any)
        : null,
    } as any,
  });

  // Canonical revision + capture provenance
  const docRev = await ensureDocumentRevisionForStoredFile(rec.id);

  await recordCaptureEvent({
    pipelineName: meta?.captureType === "URL_PDF" ? "crawl.pdf" : "crawl.text",
    pipelineConfig: {
      userAgent: "SmartScrape/1.0",
      ssrfGuard: true,
      robotsRespect: true,
      captureType: meta?.captureType ?? "UPLOAD",
      captureMeta: meta?.captureMeta ?? null,
    },
    captureType: (meta?.captureType as any) ?? "UPLOAD",
    storedFileId: rec.id,
    documentRevisionId: docRev.id,
    urlId: meta?.urlId ?? null,
    sourceUrl: meta?.sourceUrl ?? null,
    actorId: rec.uploaderId ?? null,
    actorName: rec.uploaderName ?? null,
    requestId: (meta as any)?.requestId ?? null,
  });

  // every StoredFile must map to a canonical DocumentRevision
  try {
    await ensureDocumentRevisionForStoredFile(rec.id);
  } catch (e) {
    try {
      await prisma.storedFile.delete({ where: { id: rec.id } });
    } catch {}
    try {
      fs.unlinkSync(storagePath);
    } catch {}
    throw e;
  }

  return rec;
}

// ===================== Puppeteer helpers =====================
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isRetryablePptrError = (err: unknown) => {
  const m = String((err as any)?.message || "").toLowerCase();
  return (
    m.includes("frame was detached") ||
    m.includes("attempted to use detached frame") ||
    m.includes("target closed") ||
    m.includes("crashed") ||
    m.includes("navigation failed") ||
    m.includes("execution context was destroyed") ||
    m.includes("cannot find context with specified id") ||
    m.includes("net::")
  );
};

async function launchBrowser(): Promise<Browser> {
  const opts: LaunchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  };
  return await puppeteer.launch(opts);
}

async function navigateWithRetries(page: Page, url: string) {
  let tries = 0;
  while (tries < 3) {
    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60_000,
      } as any);
      return;
    } catch (e) {
      if (!isRetryablePptrError(e)) throw e;
      tries += 1;
      await delay(500 * tries);
    }
  }
  throw new Error("Failed to navigate after retries");
}

// ===================== Tag merge helper =====================
function mergeTags(a?: string[] | null, b?: string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const arr of [a ?? [], b ?? []]) {
    for (const raw of arr) {
      const t = (raw ?? "").toString().trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

// ===================== Controllers =====================

/**
 * POST /api/crawl/text
 * Body: { url, folderId?, fileName?, urlId? }
 * - Creates a .txt StoredFile from the URL's readable article text
 * - Copies tags from the source URL (if urlId provided)
 * - Schedules background auto-tagging (scheduleFileAutoTag)
 */
export async function crawlTextHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { url, folderId, fileName, urlId } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "Body must include { url }" });
    }

    // --------- Guardrails START ---------
    let __u: URL;
    try {
      __u = new URL(url);
    } catch {
      return res.status(400).json({ message: "invalid url" });
    }

    if (__u.protocol !== "http:" && __u.protocol !== "https:") {
      return res.status(400).json({ message: "unsupported protocol" });
    }

    await resolveAndGuard(__u.hostname);
    const __allowed = await isRobotsAllowed(__u.toString());
    if (!__allowed) {
      return res.status(403).json({ message: "Blocked by robots.txt" });
    }
    log.info("crawlTextHandler_begin", { ...requestMeta(req), url });

    // ---- PDF-aware text capture (works for URLs that directly serve PDFs or SCI wrappers) ----
    try {
      const direct = resolveWrappedPdfToDirect(__u);
      const candidates = [...(direct && direct !== url ? [direct] : []), url];

      for (const candidate of candidates) {
        let cu: URL;
        try {
          cu = new URL(candidate);
        } catch {
          continue;
        }

        const likelyPdf = looksLikePdfUrl(cu);

        const sniff = await fetchWithTimeout(candidate, 15_000, {
          Range: "bytes=0-4095",
          Accept: "application/pdf,*/*;q=0.9,text/html;q=0.8,*/*;q=0.7",
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${cu.origin}/`,
        });

        const sniffCt = (sniff.headers.get("content-type") || "").toLowerCase();
        const sniffBuf = Buffer.from(await sniff.arrayBuffer());

        const isPdfUrl =
          likelyPdf ||
          sniffCt.includes("application/pdf") ||
          isPdfMagic(sniffBuf);

        if (!isPdfUrl) continue;

        const full = await fetchWithTimeout(candidate, 90_000, {
          Accept: "application/pdf,*/*",
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${cu.origin}/`,
        });
        if (!full.ok) continue;

        const pdfBytes = Buffer.from(await full.arrayBuffer());
        if (!isPdfMagic(pdfBytes)) continue;

        const cd = full.headers.get("content-disposition");
        const pdfName = bestPdfFileName(cu, cd);
        const titleFromPdf = pdfName.replace(/\.pdf$/i, "");

        const parsed = await pdfParse(pdfBytes);
        const textContentPdf = (parsed.text || "")
          .replace(/\r\n/g, "\n")
          .trim();

        const headerPdf = [
          `Title: ${titleFromPdf}`,
          `URL: ${url}`,
          `Source PDF: ${pdfName}`,
          `Captured: ${new Date().toISOString()}`,
          "".padEnd(80, "—"),
          "",
        ].join("\n");

        const bufferPdf = Buffer.from(
          headerPdf + textContentPdf + "\n",
          "utf8",
        );

        const finalNamePdf = sanitizeName(
          (fileName as string) || `${titleFromPdf || "document"}.txt`,
        );
        const descPdf = `Text extracted from PDF URL ${url}`;

        const fileRecPdf = await persistFile(
          bufferPdf,
          finalNamePdf,
          descPdf,
          folderId || null,
          {
            captureType: "URL_TEXT",
            sourceUrl: url,
            urlId: typeof urlId === "number" ? urlId : null,
          },
        );

        // Copy tags from the source URL if provided
        if (urlId !== undefined && urlId !== null) {
          const idNum = typeof urlId === "string" ? parseInt(urlId, 10) : urlId;
          if (!Number.isNaN(idNum)) {
            try {
              const src = await prisma.url.findUnique({
                where: { id: idNum as number },
                select: { tags: true },
              });
              if (src?.tags?.length) {
                const merged = mergeTags(fileRecPdf.tags, src.tags);
                await prisma.storedFile.update({
                  where: { id: fileRecPdf.id },
                  data: { tags: merged },
                });
              }
            } catch {}
          }
        }

        scheduleAiTagForFile(String(fileRecPdf.id));

        const latestPdf = await prisma.storedFile.findUnique({
          where: { id: fileRecPdf.id },
        });
        log.info("crawl_text_done_pdf", {
          ...requestMeta(req),
          fileId: fileRecPdf.id,
        });
        return res.status(201).json(latestPdf ?? fileRecPdf);
      }
    } catch (e) {
      // Not fatal: fall back to HTML Readability pipeline below
      log.info("crawl_text_pdf_fallback_to_html", {
        ...requestMeta(req),
        url,
        error: String((e as any)?.message || e),
      });
    }

    // 1) Fetch HTML (fallback to headless browser)
    let html = "";
    try {
      const resp = await fetch(url as any, { redirect: "follow" as any });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
      log.info("crawl_text_fetch_ok", { ...requestMeta(req), url });
    } catch {
      log.warn("crawl_text_fetch_failed_fallback_to_browser", {
        ...requestMeta(req),
        url,
      });
      const b = await launchBrowser();
      try {
        const page = await b.newPage();
        await navigateWithRetries(page, url);
        await page.waitForSelector("body", { timeout: 30_000 } as any);
        html = await page.content();
        log.info("crawl_text_browser_loaded", { ...requestMeta(req), url });
      } finally {
        try {
          await b.close();
        } catch {}
      }
    }

    // 2) Extract readable text
    const dom = createDom(html, url);
    const doc = dom.window.document;

    const reader = new Readability(doc);
    const article = reader.parse();

    const title = (
      article?.title ||
      doc.querySelector("title")?.textContent ||
      url
    ).trim();

    let textContent = (article?.textContent || doc.body?.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!textContent) {
      doc
        .querySelectorAll("script, style, noscript")
        .forEach((n) => n.remove());
      textContent = (doc.body?.textContent || "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const header = [
      `Title: ${title}`,
      `URL: ${url}`,
      `Captured: ${new Date().toISOString()}`,
      "".padEnd(80, "—"),
      "",
    ].join("\n");

    const buffer = Buffer.from(header + textContent + "\n", "utf8");
    const finalName = sanitizeName(
      (fileName as string) || `${title || "page"}.txt`,
    );
    const desc = `Text capture from ${url}`;

    // 3) Persist file
    const fileRec = await persistFile(
      buffer,
      finalName,
      desc,
      folderId || null,
      {
        captureType: "URL_TEXT",
        sourceUrl: url,
        urlId: typeof urlId === "number" ? urlId : null,
      },
    );

    // 4) Copy tags from the source URL if provided
    if (urlId !== undefined && urlId !== null) {
      const idNum = typeof urlId === "string" ? parseInt(urlId, 10) : urlId;
      if (!Number.isNaN(idNum)) {
        try {
          const src = await prisma.url.findUnique({
            where: { id: idNum as number },
            select: { tags: true },
          });
          if (src?.tags?.length) {
            const merged = mergeTags(fileRec.tags, src.tags);
            await prisma.storedFile.update({
              where: { id: fileRec.id },
              data: { tags: merged },
            });
          }
        } catch (e) {
          log.error("crawl_text_fetch_failed", {
            ...requestMeta(req),
            url,
            error: String(e),
          });
        }
      }
    }

    // 5) Background auto-tagging (Python ai-tagger)
    scheduleAiTagForFile(String(fileRec.id));

    // 6) Return latest (after any tag copy)
    const latest = await prisma.storedFile.findUnique({
      where: { id: fileRec.id },
    });
    log.info("crawl_text_done", { ...requestMeta(req), fileId: fileRec.id });
    return res.status(201).json(latest ?? fileRec);
  } catch (err) {
    // logging must never throw, and we must log the actual request url (not global URL).
    try {
      const url = (req.body as any)?.url;
      log.error("crawlTextHandler_error", {
        ...requestMeta(req),
        url,
        error: String((err as any)?.message || err),
      });
    } catch {
      // last-resort logging (never throw from error handler)
      log.error("crawlTextHandler_error", { error: "logging_failed" });
    }
    next(err);
  }
}

/**
 * POST /api/crawl/pdf
 * Body: { url, folderId?, fileName?, fullPage?, urlId? }
 * - Creates a PDF snapshot of the page
 * - Copies tags from the source URL (if urlId provided)
 * - Schedules background auto-tagging (scheduleFileAutoTag)
 */
export async function crawlPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { url, folderId, fileName, fullPage = true, urlId } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "Body must include { url }" });
    }

    // --------- Guardrails START ---------
    let __u: URL;
    try {
      __u = new URL(url);
    } catch {
      return res.status(400).json({ message: "invalid url" });
    }

    if (__u.protocol !== "http:" && __u.protocol !== "https:") {
      return res.status(400).json({ message: "unsupported protocol" });
    }

    await resolveAndGuard(__u.hostname);
    const __allowed = await isRobotsAllowed(__u.toString());
    if (!__allowed) {
      return res.status(403).json({ message: "Blocked by robots.txt" });
    }
    log.info("crawlPdfHandler_begin", { ...requestMeta(req), url });

    // --------- Guardrails END ---------

    // Common post-processing (copy URL tags + schedule ai-tag + respond)
    const postProcessAndRespond = async (fileRec: any) => {
      // Copy tags from the source URL if provided
      if (urlId !== undefined && urlId !== null) {
        const idNum = typeof urlId === "string" ? parseInt(urlId, 10) : urlId;
        if (!Number.isNaN(idNum)) {
          try {
            const src = await prisma.url.findUnique({
              where: { id: idNum as number },
              select: { tags: true },
            });
            if (src?.tags?.length) {
              const merged = mergeTags(fileRec.tags, src.tags);
              await prisma.storedFile.update({
                where: { id: fileRec.id },
                data: { tags: merged },
              });
            }
          } catch (e) {
            console.error("[crawlPdf] copy URL tags failed", {
              urlId,
              fileId: fileRec.id,
              e,
            });
          }
        }
      }

      // Background auto-tagging
      scheduleAiTagForFile(String(fileRec.id));

      const latest = await prisma.storedFile.findUnique({
        where: { id: fileRec.id },
      });
      if (res.headersSent || (req as any).timedout) return;
      return res.status(201).json(latest ?? fileRec);
    };

    // ===== Fast-path: try DIRECT PDF bytes (handles SCI wrapper URLs via filename=...) =====
    try {
      const direct = resolveWrappedPdfToDirect(__u);

      const candidates = [...(direct && direct !== url ? [direct] : []), url];

      for (const candidate of candidates) {
        let cu: URL;
        try {
          cu = new URL(candidate);
        } catch {
          continue;
        }

        const sniff = await fetchWithTimeout(candidate, 15_000, {
          Range: "bytes=0-4095",
          Accept: "application/pdf,*/*;q=0.9,text/html;q=0.8,*/*;q=0.7",
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${cu.origin}/`,
        });

        const sniffCt = (sniff.headers.get("content-type") || "").toLowerCase();
        const sniffBuf = Buffer.from(await sniff.arrayBuffer());

        const likelyPdf = looksLikePdfUrl(cu);
        const isPdf =
          sniffCt.includes("application/pdf") ||
          isPdfMagic(sniffBuf) ||
          likelyPdf;

        if (!isPdf) continue;

        const full = await fetchWithTimeout(candidate, 90_000, {
          Accept: "application/pdf,*/*",
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${cu.origin}/`,
        });
        if (!full.ok) continue;

        const pdfBytes = Buffer.from(await full.arrayBuffer());
        if (!isPdfMagic(pdfBytes)) continue;

        const cd = full.headers.get("content-disposition");
        const derivedName = bestPdfFileName(cu, cd);
        const finalName = sanitizeName((fileName as string) || derivedName);

        const desc =
          candidate === url
            ? `Original PDF from ${url}`
            : `Original PDF (resolved from wrapper) from ${url}`;

        const fileRec = await persistFile(
          pdfBytes,
          finalName.toLowerCase().endsWith(".pdf")
            ? finalName
            : `${finalName}.pdf`,
          desc,
          folderId || null,
          {
            captureType: "URL_PDF",
            sourceUrl: url, // keep wrapper as provenance
            urlId: typeof urlId === "number" ? urlId : null,
          },
        );

        log.info("crawl_pdf_direct_download_done", {
          ...requestMeta(req),
          url,
          resolvedUrl: candidate,
          bytes: pdfBytes.length,
          fileId: fileRec.id,
        });

        return await postProcessAndRespond(fileRec);
      }
    } catch (e) {
      // Not fatal: just fall back to Puppeteer snapshot mode
      log.info("crawl_pdf_direct_download_fallback", {
        ...requestMeta(req),
        url,
        error: String((e as any)?.message || e),
      });
    }

    // ===== Fallback: open wrapper in Puppeteer and intercept REAL PDF response bytes =====
    try {
      const b = await launchBrowser();
      try {
        const page = await b.newPage();
        page.setDefaultTimeout(60_000);
        page.setDefaultNavigationTimeout(60_000);
        await page.emulateMediaType("screen");

        await page.setUserAgent(BROWSER_UA);
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
        });

        let done = false;
        const pdfHit = new Promise<{
          bytes: Buffer;
          pdfUrl: string;
          cd: string | null;
        } | null>((resolve) => {
          const finish = (v: any) => {
            if (done) return;
            done = true;
            resolve(v);
          };

          page.on("response", async (resp) => {
            try {
              const respUrl = resp.url();
              const respUrlL = respUrl.toLowerCase();
              const h = resp.headers();
              const ct = String((h as any)["content-type"] || "").toLowerCase();
              const cd = (h as any)["content-disposition"]
                ? String((h as any)["content-disposition"])
                : null;

              // Avoid buffering *everything*. Only buffer if it *might* be a PDF.
              const ctPdfish =
                ct.includes("application/pdf") ||
                ct.includes("application/octet-stream") ||
                ct.includes("application/download");

              const cdPdfish =
                !!cd &&
                (cd.toLowerCase().includes(".pdf") ||
                  cd.toLowerCase().includes("pdf"));

              const urlPdfish =
                respUrlL.includes(".pdf") ||
                respUrlL.includes("pdf") ||
                respUrlL.includes("download");

              const rt = (resp.request?.() as any)?.resourceType?.() || "";
              const rtPdfish =
                rt === "xhr" ||
                rt === "fetch" ||
                rt === "document" ||
                rt === "iframe";

              const maybePdf = ctPdfish || cdPdfish || (urlPdfish && rtPdfish);
              if (!maybePdf) return;

              const bytes = await (resp as any).buffer();
              if (!bytes || bytes.length < 1024) return;

              // hard cap (avoid OOM on huge downloads)
              if (bytes.length > 50 * 1024 * 1024) return;

              if (!isPdfMagic(bytes)) return;

              finish({ bytes, pdfUrl: respUrl, cd });
            } catch {
              // ignore
            }
          });

          setTimeout(() => finish(null), 45_000);
        });

        const { reader = true } = req.body || {};
        if (reader) {
          try {
            await setReadableContentOnPage(page, url);
          } catch {
            await hardenLivePage(page, url);
            await navigateWithRetries(page, url);
            await page.waitForSelector("body", { timeout: 30_000 } as any);
            await new Promise((r) => setTimeout(r, 700));
          }
        } else {
          await hardenLivePage(page, url);
          await navigateWithRetries(page, url);
          await page.waitForSelector("body", { timeout: 30_000 } as any);
          await new Promise((r) => setTimeout(r, 700));
        }

        // ===== Step 5: try to discover & fetch real PDFs linked/embedded on the page =====
        try {
          const cookie = await cookieHeaderFor(page, url);
          const candidates = await extractPdfCandidates(page, url);

          for (const c of candidates.slice(0, 15)) {
            try {
              const cu = new URL(c);
              await resolveAndGuard(cu.hostname);
            } catch {
              continue;
            }

            const dl = await downloadPdfWithHeaders(c, {
              referer: url,
              cookie,
            });
            if (!dl) continue;

            const derivedName = bestPdfFileName(new URL(c), dl.cd);
            const finalName = sanitizeName((fileName as string) || derivedName);
            const desc = `Original PDF (found on page) from ${url}`;

            const fileRec = await persistFile(
              dl.bytes,
              finalName.toLowerCase().endsWith(".pdf")
                ? finalName
                : `${finalName}.pdf`,
              desc,
              folderId || null,
              {
                captureType: "URL_PDF",
                sourceUrl: url,
                urlId: typeof urlId === "number" ? urlId : null,
                captureMeta: {
                  method: "dom_candidate_fetch",
                  capturedUrl: c,
                  contentDisposition: dl.cd,
                  contentType: dl.ct,
                  bytes: dl.bytes.length,
                },
              },
            );

            log.info("crawl_pdf_dom_candidate_done", {
              ...requestMeta(req),
              url,
              candidateUrl: c,
              bytes: dl.bytes.length,
              fileId: fileRec.id,
            });

            return await postProcessAndRespond(fileRec);
          }

          // If the PDF isn't directly linkable, try a conservative "download/pdf" click to trigger XHR.
          const clicked = await tryClickPdfDownload(page);
          if (clicked) {
            // give interception some time to catch the real PDF response
            await new Promise((r) => setTimeout(r, 6_000));
          }
        } catch (e) {
          log.info("crawl_pdf_dom_candidate_scan_failed", {
            ...requestMeta(req),
            url,
            error: String((e as any)?.message || e),
          });
        }

        const hit = await pdfHit;
        if (hit?.bytes?.length) {
          const derivedName =
            bestPdfFileName(new URL(hit.pdfUrl), hit.cd) ||
            derivePdfNameFromUrl(__u) ||
            "document.pdf";

          const finalName = sanitizeName((fileName as string) || derivedName);
          const desc = `Original PDF (intercepted via browser) from ${url}`;

          const fileRec = await persistFile(
            hit.bytes,
            finalName.toLowerCase().endsWith(".pdf")
              ? finalName
              : `${finalName}.pdf`,
            desc,
            folderId || null,
            {
              captureType: "URL_PDF",
              sourceUrl: url,
              urlId: typeof urlId === "number" ? urlId : null,
            },
          );

          log.info("crawl_pdf_intercepted_pdf_done", {
            ...requestMeta(req),
            url,
            interceptedUrl: hit.pdfUrl,
            bytes: hit.bytes.length,
            fileId: fileRec.id,
          });

          return await postProcessAndRespond(fileRec);
        }
      } finally {
        await b.close().catch(() => {});
      }
    } catch (e) {
      log.info("crawl_pdf_intercepted_pdf_fallback_to_snapshot", {
        ...requestMeta(req),
        url,
        error: String((e as any)?.message || e),
      });
    }

    // Puppeteer PDF capture
    const tryMakePdf = async () => {
      const b = await launchBrowser(); // keep your existing launcher if you have one
      try {
        const page = await b.newPage();
        page.setDefaultTimeout(60_000);
        page.setDefaultNavigationTimeout(60_000);
        await page.emulateMediaType("screen");

        const { url, reader = true } = req.body || {};

        if (reader) {
          try {
            await setReadableContentOnPage(page, url);
          } catch (e) {
            log.info("crawl_pdf_reader_failed_fallback_live", {
              ...requestMeta(req),
              url,
              error: String((e as any)?.message || e),
            });
            await hardenLivePage(page, url);
            await navigateWithRetries(page, url);
            await page.waitForSelector("body", { timeout: 30_000 } as any);
            await new Promise((r) => setTimeout(r, 700));
          }
        } else {
          await hardenLivePage(page, url);
          await navigateWithRetries(page, url);
          await page.waitForSelector("body", { timeout: 30_000 } as any);
          await new Promise((r) => setTimeout(r, 700));
        }

        log.info("crawl_pdf_browser_loaded", { ...requestMeta(req), url });

        const derived = (await page.title()) || new URL(url).hostname;
        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
          timeout: 60_000 as any,
        } as any);

        log.info("crawl_pdf_rendered", {
          ...requestMeta(req),
          url,
          bytes: pdf.length,
        });
        return { pdf, title: derived };
      } finally {
        await b.close().catch(() => {});
      }
    };

    // Retry logic
    let attempt = 0;
    let lastErr: any;
    let pdfBuf: Buffer | Uint8Array | null = null;
    let title: string | null = null;

    while (attempt < 3) {
      try {
        const { pdf, title: t } = await tryMakePdf();
        pdfBuf = pdf;
        title = t;
        break;
      } catch (e) {
        lastErr = e;
        if (!isRetryablePptrError(e)) break;
        attempt += 1;
        await delay(500 * attempt);
      }
    }
    if (!pdfBuf) throw lastErr || new Error("PDF capture failed");

    const finalName = sanitizeName(
      (fileName as string) || `${title || "page"}.pdf`,
    );
    const desc = `PDF snapshot from ${url}`;

    // 1) Persist file
    const fileRec = await persistFile(
      pdfBuf,
      finalName,
      desc,
      folderId || null,
      {
        captureType: "URL_PDF",
        sourceUrl: url,
        urlId: typeof urlId === "number" ? urlId : null,
      },
    );

    // 2) Copy tags from the source URL if provided
    if (urlId !== undefined && urlId !== null) {
      const idNum = typeof urlId === "string" ? parseInt(urlId, 10) : urlId;
      if (!Number.isNaN(idNum)) {
        try {
          const src = await prisma.url.findUnique({
            where: { id: idNum as number },
            select: { tags: true },
          });
          if (src?.tags?.length) {
            const merged = mergeTags(fileRec.tags, src.tags);
            await prisma.storedFile.update({
              where: { id: fileRec.id },
              data: { tags: merged },
            });
          }
        } catch (e) {
          console.error("[crawlPdf] copy URL tags failed", {
            urlId,
            fileId: fileRec.id,
            e,
          });
        }
      }
    }

    // 3) Background auto-tagging (Python ai-tagger)
    scheduleAiTagForFile(String(fileRec.id));

    // 4) Return latest
    const latest = await prisma.storedFile.findUnique({
      where: { id: fileRec.id },
    });
    log.info("crawl_pdf_done", { ...requestMeta(req), fileId: fileRec.id });
    if (res.headersSent || (req as any).timedout) return;
    return res.status(201).json(latest ?? fileRec);
  } catch (err) {
    // Hardened: logging must never throw, and we must log the actual request url (not global URL).
    try {
      const url = (req.body as any)?.url;
      log.error("crawlPdfHandler_error", {
        ...requestMeta(req),
        url,
        error: String((err as any)?.message || err),
      });
    } catch {
      // last-resort logging (never throw from error handler)
      log.error("crawlPdfHandler_error", { error: "logging_failed" });
    }
    next(err);
  }
}
