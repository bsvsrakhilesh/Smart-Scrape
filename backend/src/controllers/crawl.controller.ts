// backend/src/controllers/crawl.controller.ts
import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import puppeteer, { Browser, LaunchOptions, Page } from "puppeteer";
import { scheduleFileAutoTag } from "../services/tag.service"; 
import dns from "node:dns/promises";
import * as ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { log, requestMeta } from '../utils/logger';
import { setReadableContentOnPage, hardenLivePage } from "../utils/reader";

const prisma = new PrismaClient();

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

async function fetchWithTimeout(url: string, ms = 10000, headers: Record<string, string> = {}) {
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

// ===================== Storage helpers =====================
const STORAGE_DIR = process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "storage");
const FILES_DIR = path.join(STORAGE_DIR, "files");

function ensureDirs() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
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

// Accept Buffer | Uint8Array (Puppeteer returns Uint8Array)
async function persistFile(
  data: Buffer | Uint8Array,
  fileName: string,
  description: string,
  folderId?: string | null
) {
  ensureDirs();
  const id = newId();
  const safeName = sanitizeName(fileName);
  const storagePath = path.join(FILES_DIR, `${id}__${safeName}`);
  fs.writeFileSync(storagePath, data);

  const rec = await prisma.storedFile.create({
    data: {
      id, // String id
      fileName: safeName,
      description,
      size: (data as Uint8Array).byteLength ?? Buffer.byteLength(data as Buffer),
      mimeType: inferMime(safeName),
      storagePath,
      uploaderId: "self",
      uploaderName: "You",
      folderId: folderId ? String(folderId) : null,
      isFavorited: false,
    } as any,
  });

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
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 } as any);
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
export async function crawlTextHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, folderId, fileName, urlId } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "Body must include { url }" });
    }

    // --------- Guardrails START ---------
    let __u: URL;
    try { __u = new URL(url); }
    catch { return res.status(400).json({ message: "invalid url" }); }

    if (__u.protocol !== "http:" && __u.protocol !== "https:") {
      return res.status(400).json({ message: "unsupported protocol" });
    }

    await resolveAndGuard(__u.hostname);
    const __allowed = await isRobotsAllowed(__u.toString());
    if (!__allowed) {
      return res.status(403).json({ message: "Blocked by robots.txt" });
    }
    log.info("crawlTextHandler_begin", { ...requestMeta(req), url });

    // 1) Fetch HTML (fallback to headless browser)
    let html = "";
    try {
      const resp = await fetch(url as any, { redirect: "follow" as any });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
      log.info("crawl_text_fetch_ok", { ...requestMeta(req), url });
    } catch {
      log.warn("crawl_text_fetch_failed_fallback_to_browser", { ...requestMeta(req), url });
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
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const title = (article?.title || cheerio.load(html)("title").first().text() || url).trim();
    let textContent = (article?.textContent || cheerio.load(html)("body").text() || "").replace(/\n{3,}/g, "\n\n").trim();
    log.info("crawl_text_extracted", {
      ...requestMeta(req),
      url,
      title,
      textLength: textContent.length
    });

    if (!textContent) {
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      textContent = $.root().text().replace(/\n{3,}/g, "\n\n").trim();
    }

    const header = [
      `Title: ${title}`,
      `URL: ${url}`,
      `Captured: ${new Date().toISOString()}`,
      "".padEnd(80, "—"),
      "",
    ].join("\n");

    const buffer = Buffer.from(header + textContent + "\n", "utf8");
    const finalName = sanitizeName((fileName as string) || `${title || "page"}.txt`);
    const desc = `Text capture from ${url}`;

    // 3) Persist file
    const fileRec = await persistFile(buffer, finalName, desc, folderId || null);

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
          log.error('crawl_text_fetch_failed', { ...requestMeta(req), url, error: String(e) });
        }
      }
    }

    // 5) Background auto-tagging
    scheduleFileAutoTag(prisma, fileRec.id).catch((e) =>
      log.error('crawl_pdf_schedule_autotag_failed', {
    ...requestMeta(req),  fileId: fileRec.id,   error: String(e),
    }));

    // 6) Return latest (after any tag copy)
    const latest = await prisma.storedFile.findUnique({ where: { id: fileRec.id } });
    log.info("crawl_text_done", { ...requestMeta(req), fileId: fileRec.id });
    return res.status(201).json(latest ?? fileRec);
  } catch (err) {
    log.error("crawlTextHandler_error", { ...requestMeta(req), URL, error: String((err as any)?.message || err) });
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
export async function crawlPdfHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, folderId, fileName, fullPage = true, urlId } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "Body must include { url }" });
    }

    // --------- Guardrails START ---------
    let __u: URL;
    try { __u = new URL(url); }
    catch { return res.status(400).json({ message: "invalid url" }); }

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

    // Puppeteer PDF capture

    // Puppeteer PDF capture (drop-in replacement)
const tryMakePdf = async () => {
  const b = await launchBrowser(); // keep your existing launcher if you have one
  try {
    const page = await b.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    await page.emulateMediaType("screen");

    const { url, reader = true } = req.body || {};

    if (reader) {
      await setReadableContentOnPage(page, url);
    } else {
      await hardenLivePage(page, url);
      await navigateWithRetries(page, url); // keep your existing helper
      await page.waitForSelector("body", { timeout: 30_000 } as any);
      await new Promise(r => setTimeout(r, 700)); // small settle
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

    log.info("crawl_pdf_rendered", { ...requestMeta(req), url, bytes: pdf.length });
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

    const finalName = sanitizeName((fileName as string) || `${title || "page"}.pdf`);
    const desc = `PDF snapshot from ${url}`;

    // 1) Persist file
    const fileRec = await persistFile(pdfBuf, finalName, desc, folderId || null);

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
          console.error("[crawlPdf] copy URL tags failed", { urlId, fileId: fileRec.id, e });
        }
      }
    }

    // 3) Background auto-tagging
    scheduleFileAutoTag(prisma, fileRec.id).catch((e) =>
      console.error("[crawlPdf] scheduleFileAutoTag failed", fileRec.id, e)
    );

    // 4) Return latest
    const latest = await prisma.storedFile.findUnique({ where: { id: fileRec.id } });
    log.info("crawl_pdf_done", { ...requestMeta(req), fileId: fileRec.id });
    if (res.headersSent || (req as any).timedout) return;
    return res.status(201).json(latest ?? fileRec);
  } catch (err) {
    log.error("crawlPdfHandler_error", { ...requestMeta(req), URL, error: String((err as any)?.message || err) });
    next(err);
  }
}

