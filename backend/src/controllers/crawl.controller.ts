// backend/src/controllers/crawl.controller.ts
import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/database";
import { ensureDocumentRevisionForStoredFile } from "../services/document.service";
import { recordCaptureEvent } from "../services/provenance.service";
import { copyUrlTagsToFile } from "../services/tag-transfer.service";
import { createDom } from "../utils/dom";
import { Readability } from "@mozilla/readability";
import puppeteer, { Browser, LaunchOptions, Page } from "puppeteer-core";
import { env } from "../config/env";
import { scheduleAiTagForFile } from "../services/aiTagAuto.service";
import dns from "node:dns/promises";
import { setDefaultResultOrder } from "node:dns";
import * as ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { log, requestMeta } from "../utils/logger";
import { setReadableContentOnPage, hardenLivePage } from "../utils/reader";
import { probeUrlKind } from "../services/urlProbe.service";
import { captureViaInstitutionalNode } from "../services/institutionalCapture.service";
import { execFile } from "node:child_process";

try {
  setDefaultResultOrder("ipv4first");
} catch {
  // no-op: older runtimes or restricted environments
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

const PDF_INTERCEPT_MAX_BYTES = Math.max(
  10 * 1024 * 1024,
  Number(process.env.PDF_INTERCEPT_MAX_BYTES || 250 * 1024 * 1024),
);

const DISABLE_PDF_SNAPSHOT_FALLBACK_FOR_PDF_URLS =
  String(
    process.env.DISABLE_PDF_SNAPSHOT_FALLBACK_FOR_PDF_URLS ?? "true",
  ).toLowerCase() !== "false";

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

function normalizePdfCandidateUrl(raw: string, base: URL): string | null {
  const decoded = tryDecodeUrlish(raw);
  if (!decoded) return null;

  const lower = decoded.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("javascript:")
  ) {
    return null;
  }

  try {
    const abs = new URL(decoded, base).toString();
    const absLower = abs.toLowerCase();

    if (!/^https?:\/\//i.test(abs)) return null;
    if (!absLower.includes(".pdf")) return null;

    return abs;
  } catch {
    return null;
  }
}

function resolveWrappedPdfToDirect(u: URL): string | null {
  const preferredKeys = [
    "filename",
    "file",
    "filepath",
    "path",
    "pdf",
    "pdfurl",
    "download",
    "doc",
    "document",
    "attachment",
  ];

  for (const key of preferredKeys) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;

    const candidate = normalizePdfCandidateUrl(raw, u);
    if (candidate) return candidate;
  }

  for (const [, value] of u.searchParams.entries()) {
    const candidate = normalizePdfCandidateUrl(value, u);
    if (candidate) return candidate;
  }

  return null;
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
    | "page_print"
    | "institutional_node";
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
    const currentUrl =
      typeof page?.url === "function" ? String(page.url() || "") : "";

    const urls = Array.from(
      new Set(
        [targetUrl, currentUrl].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        ),
      ),
    );

    let cookies: any[] = [];

    for (const u of urls) {
      try {
        const bucket = await page.cookies(u);
        if (Array.isArray(bucket) && bucket.length) cookies.push(...bucket);
      } catch {
        // ignore per-url cookie failures
      }
    }

    try {
      const pageWide = await page.cookies();
      if (Array.isArray(pageWide) && pageWide.length) cookies.push(...pageWide);
    } catch {
      // ignore page-wide cookie failures
    }

    if (!Array.isArray(cookies) || cookies.length === 0) return null;

    const seen = new Set<string>();
    const deduped = cookies.filter((c: any) => {
      const key = `${c.name}|${c.domain || ""}|${c.path || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!deduped.length) return null;

    return deduped.map((c: any) => `${c.name}=${c.value}`).join("; ");
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
        if (s.startsWith("data:")) return;
        if (s.startsWith("blob:")) return;
        out.push(s);
      };

      const maybePdfish = (s: string) => {
        const t = String(s || "").toLowerCase();
        return (
          t.includes(".pdf") ||
          /(?:^|[?&#])(file|filename|pdf|download|path|attachment)=/i.test(t)
        );
      };

      // obvious embeds and links
      document
        .querySelectorAll("iframe, embed, object, a[href], link[href]")
        .forEach((el: any) => {
          const src = el.getAttribute?.("src");
          const href = el.getAttribute?.("href");
          const data = el.getAttribute?.("data");

          [src, href, data].forEach((v) => {
            if (v && maybePdfish(v)) push(v);
          });

          const text = String(el.textContent || "").toLowerCase();
          if (href && (text.includes("pdf") || text.includes("download"))) {
            push(href);
          }
        });

      // broader attribute scan for viewer widgets / JS-driven embeds
      const attrNames = [
        "src",
        "href",
        "data",
        "data-url",
        "data-src",
        "data-file",
        "data-pdf",
        "data-download",
      ];

      document.querySelectorAll("*").forEach((el: any) => {
        attrNames.forEach((attr) => {
          const v = el.getAttribute?.(attr);
          if (v && maybePdfish(v)) push(v);
        });
      });

      // current-page query params / hash patterns
      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.search);

      ["file", "filename", "pdf", "path", "download", "attachment"].forEach(
        (key) => {
          const v = params.get(key);
          if (v) push(v);
        },
      );

      const hash = String(url.hash || "");
      const hashRe =
        /(?:^|[?#&])(file|filename|pdf|path|download|attachment)=([^&]+)/gi;
      let hm: RegExpExecArray | null;

      while ((hm = hashRe.exec(hash)) !== null) {
        if (hm[2]) {
          try {
            push(decodeURIComponent(hm[2]));
          } catch {
            push(hm[2]);
          }
        }
      }

      // meta tags sometimes carry the downloadable asset
      document.querySelectorAll("meta[content]").forEach((el: any) => {
        const v = el.getAttribute?.("content");
        if (v && maybePdfish(v)) push(v);
      });

      // inline scripts often contain PDF.js config or direct asset URLs
      document.querySelectorAll("script:not([src])").forEach((el: any) => {
        const t = String(el.textContent || "");

        const directRe = /(?:https?:\/\/|\/)[^"'`\s)]+\.pdf(?:\?[^"'`\s)]*)?/gi;
        let dm: RegExpExecArray | null;
        while ((dm = directRe.exec(t)) !== null) {
          if (dm[0]) push(dm[0]);
        }

        const keyedRe =
          /(?:file|filename|pdf|pdfUrl|downloadUrl|path)\s*[:=]\s*['"`]([^'"`]+)['"`]/gi;
        let km: RegExpExecArray | null;
        while ((km = keyedRe.exec(t)) !== null) {
          if (km[1]) push(km[1]);
        }
      });

      return Array.from(new Set(out));
    });

    const base = new URL(baseUrl);

    const normalized = raw
      .map((u) => normalizePdfCandidateUrl(u, base))
      .filter(Boolean) as string[];

    return Array.from(new Set(normalized));
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

async function downloadPdfWithWget(
  targetUrl: string,
  opts: { referer?: string; cookie?: string | null },
): Promise<{ bytes: Buffer; cd: string | null; ct: string | null } | null> {
  const parseMeta = (stderrText: string) => {
    const ctMatch = stderrText.match(/^\s*Content-Type:\s*(.+)$/im);
    const cdMatch = stderrText.match(/^\s*Content-Disposition:\s*(.+)$/im);
    const statusMatch = stderrText.match(/^\s*HTTP\/[0-9.]+\s+(\d{3})/im);

    return {
      ct: ctMatch?.[1]?.trim() ?? null,
      cd: cdMatch?.[1]?.trim() ?? null,
      statusCode: statusMatch?.[1] ? Number(statusMatch[1]) : null,
    };
  };

  const summarizeStderr = (stderrText: string) =>
    stderrText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-12)
      .join(" | ")
      .slice(0, 2000);

  const runOne = async (
    mode:
      | "default_stack"
      | "ipv4_only"
      | "no_check_cert"
      | "no_check_cert_ipv4",
    extraArgs: string[],
  ): Promise<{
    bytes: Buffer;
    cd: string | null;
    ct: string | null;
  } | null> => {
    const args: string[] = [
      "--no-verbose",
      "--server-response",
      "--max-redirect=10",
      "--timeout=120",
      "--tries=2",
      "--waitretry=2",
      "-O",
      "-",
      "--user-agent",
      BROWSER_UA,
      "--header",
      "Accept: application/pdf,*/*",
      ...extraArgs,
    ];

    if (opts.referer) {
      args.push("--referer", opts.referer);
    }

    if (opts.cookie) {
      args.push("--header", `Cookie: ${opts.cookie}`);
    }

    args.push(targetUrl);

    return await new Promise((resolve) => {
      execFile(
        "wget",
        args,
        {
          encoding: "buffer",
          maxBuffer: PDF_INTERCEPT_MAX_BYTES,
        } as any,
        (error, stdout, stderr) => {
          const out = Buffer.isBuffer(stdout)
            ? stdout
            : stdout
              ? Buffer.from(stdout as any)
              : Buffer.alloc(0);

          const errText = Buffer.isBuffer(stderr)
            ? stderr.toString("utf8")
            : String(stderr || "");

          const meta = parseMeta(errText);

          if (out.length >= 1024 && isPdfMagic(out)) {
            log.info("crawl_pdf_wget_attempt_succeeded", {
              targetUrl,
              mode,
              bytes: out.length,
              statusCode: meta.statusCode,
              contentType: meta.ct,
              insecureTls:
                mode === "no_check_cert" || mode === "no_check_cert_ipv4",
            });

            return resolve({
              bytes: out,
              cd: meta.cd,
              ct: meta.ct,
            });
          }

          log.info("crawl_pdf_wget_attempt_failed", {
            targetUrl,
            mode,
            statusCode: meta.statusCode,
            bytes: out.length,
            contentType: meta.ct,
            error: error ? String((error as any)?.message || error) : null,
            errorCode: (error as any)?.code ?? null,
            signal: (error as any)?.signal ?? null,
            stderr: summarizeStderr(errText),
            insecureTls:
              mode === "no_check_cert" || mode === "no_check_cert_ipv4",
          });

          return resolve(null);
        },
      );
    });
  };

  return (
    (await runOne("default_stack", [])) ??
    (await runOne("ipv4_only", ["--inet4-only"])) ??
    (await runOne("no_check_cert", ["--no-check-certificate"])) ??
    (await runOne("no_check_cert_ipv4", [
      "--no-check-certificate",
      "--inet4-only",
    ])) ??
    null
  );
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

const DEFAULT_CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Chromium\\Application\\chrome.exe",
].filter(Boolean);

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
    "Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH (or PUPPETEER_EXECUTABLE_PATH) to a valid Chrome/Chromium binary.",
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

  return await puppeteer.launch(opts);
}

async function navigateWithRetries(
  page: Page,
  url: string,
  opts: { pdfLike?: boolean } = {},
) {
  const { pdfLike = false } = opts;
  let tries = 0;

  while (tries < 3) {
    try {
      await page.goto(url, {
        waitUntil: pdfLike ? "domcontentloaded" : "networkidle2",
        timeout: 60_000,
      } as any);
      return;
    } catch (e) {
      const msg = String((e as any)?.message || "").toLowerCase();

      // For PDF-like URLs the browser aborts navigation (ERR_ABORTED,
      // net:: errors, "Failed to navigate") but the PDF bytes are still
      // delivered via the response event listener set up by the caller.
      // Treat ANY navigation error as a soft-return so that the
      // response-interception promise (pdfHit) can still resolve.
      if (pdfLike) {
        return;
      }

      if (!isRetryablePptrError(e)) throw e;
      tries += 1;
      await delay(500 * tries);
    }
  }

  if (pdfLike) {
    // Exhausted retries but still pdfLike — let the response listener decide.
    return;
  }

  throw new Error("Failed to navigate after retries");
}

// ===================== Capture finalize helper =====================
async function finalizeCapturedFile(
  fileRec: any,
  urlId: number | string | null | undefined,
  req: Request,
  res: Response,
) {
  let shouldRunFileTagger = true;

  if (urlId !== undefined && urlId !== null) {
    const idNum = typeof urlId === "string" ? parseInt(urlId, 10) : urlId;
    if (!Number.isNaN(idNum)) {
      try {
        const transfer = await copyUrlTagsToFile(
          prisma,
          idNum as number,
          String(fileRec.id),
        );
        shouldRunFileTagger = !transfer.copiedAiTags;
      } catch (e) {
        log.error("finalizeCapturedFile_copy_tags_failed", {
          ...requestMeta(req),
          fileId: fileRec.id,
          urlId,
          error: String((e as any)?.message || e),
        });
      }
    }
  }

  if (shouldRunFileTagger) {
    scheduleAiTagForFile(String(fileRec.id));
  }

  const latest = await prisma.storedFile.findUnique({
    where: { id: fileRec.id },
  });

  if (res.headersSent || (req as any).timedout) return;
  return res.status(201).json(latest ?? fileRec);
}

// ===================== Controllers =====================

/**
 * POST /api/crawl/text
 * Body: { url, folderId?, fileName?, urlId? }
 * - Creates a .txt StoredFile from the URL's readable article text
 * - Copies source URL tag metadata (if urlId provided)
 * - Schedules file auto-tagging only when no URL AI tag metadata was copied
 */
export async function crawlTextHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {
      url,
      folderId,
      fileName,
      urlId,
      accessMode = "public",
    } = req.body || {};
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

    if (accessMode === "institutional") {
      log.info("crawlTextHandler_institutional_begin", {
        ...requestMeta(req),
        url,
      });

      const captured = await captureViaInstitutionalNode({
        mode: "text",
        url: __u.toString(),
        fileName: typeof fileName === "string" ? fileName : null,
        requestId: (req as any).requestId ?? null,
      });

      const noteBits = [
        captured.provider ? `provider=${captured.provider}` : null,
        captured.nodeName ? `node=${captured.nodeName}` : null,
        captured.note || null,
      ].filter(Boolean);

      const resolvedName =
        (typeof fileName === "string" && fileName.trim()) ||
        captured.fileName ||
        `${__u.hostname.replace(/^www\./, "")}.txt`;

      const finalName = sanitizeName(
        resolvedName.toLowerCase().endsWith(".txt")
          ? resolvedName
          : `${resolvedName}.txt`,
      );

      const fileRec = await persistFile(
        captured.buffer,
        finalName,
        `Institutional text capture from ${url}`,
        folderId || null,
        {
          captureType: "URL_TEXT",
          sourceUrl: captured.finalUrl || url,
          urlId: typeof urlId === "number" ? urlId : null,
          requestId: (req as any).requestId ?? null,
          captureMeta: {
            method: "institutional_node",
            capturedUrl: captured.finalUrl || url,
            contentType: captured.mimeType,
            bytes: captured.buffer.byteLength,
            notes: noteBits.join(" • "),
          },
        },
      );

      return finalizeCapturedFile(fileRec, urlId, req, res);
    }

    const __allowed = await isRobotsAllowed(__u.toString());
    if (!__allowed) {
      return res.status(403).json({ message: "Blocked by robots.txt" });
    }
    log.info("crawlTextHandler_begin", { ...requestMeta(req), url });

    // ---- Guardrail: Text extraction is disabled for PDF URLs ----
    try {
      // Best-effort probe: HEAD first, falls back to small Range GET + magic bytes
      const probe = await probeUrlKind(__u.toString());

      if (probe.kind === "pdf") {
        return res.status(400).json({
          code: "PDF_URL_TEXT_DISABLED",
          message:
            "Text capture is disabled for PDF URLs. Use the PDF capture endpoint (/api/crawl/pdf).",
          url,
          probe,
        });
      }
    } catch (e) {
      // If probe fails, we don't want false blocks; fall back to HTML pipeline
      log.info("crawl_text_probe_failed_fallback_to_html", {
        ...requestMeta(req),
        url,
        error: String((e as any)?.message || e),
      });
    }

    // Optional safety net: if a PDF wrapper resolves to a direct PDF link, also block text.
    // (Keeps behavior aligned with frontend even when probe is inconclusive.)
    try {
      const direct = resolveWrappedPdfToDirect(__u);
      const candidate = direct && direct !== url ? direct : url;
      const cu = new URL(candidate);

      const sniff = await fetchWithTimeout(candidate, 15_000, {
        Range: "bytes=0-4095",
        Accept: "application/pdf,*/*;q=0.9,text/html;q=0.8,*/*;q=0.7",
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${cu.origin}/`,
      });

      const sniffCt = (sniff.headers.get("content-type") || "").toLowerCase();
      const sniffBuf = Buffer.from(await sniff.arrayBuffer());

      const isPdf =
        looksLikePdfUrl(cu) ||
        sniffCt.includes("application/pdf") ||
        isPdfMagic(sniffBuf);

      if (isPdf) {
        return res.status(400).json({
          code: "PDF_URL_TEXT_DISABLED",
          message:
            "Text capture is disabled for PDF URLs. Use the PDF capture endpoint (/api/crawl/pdf).",
          url,
          directPdfUrl: candidate,
        });
      }
    } catch {
      // ignore and proceed
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

    log.info("crawl_text_done", { ...requestMeta(req), fileId: fileRec.id });
    return finalizeCapturedFile(fileRec, urlId, req, res);
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
 * - Copies source URL tag metadata (if urlId provided)
 * - Schedules file auto-tagging only when no URL AI tag metadata was copied
 */
export async function crawlPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {
      url,
      folderId,
      fileName,
      fullPage = true,
      urlId,
      accessMode = "public",
    } = req.body || {};
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

    if (accessMode === "institutional") {
      log.info("crawlPdfHandler_institutional_begin", {
        ...requestMeta(req),
        url,
      });

      const captured = await captureViaInstitutionalNode({
        mode: "pdf",
        url: __u.toString(),
        fileName: typeof fileName === "string" ? fileName : null,
        requestId: (req as any).requestId ?? null,
      });

      const noteBits = [
        captured.provider ? `provider=${captured.provider}` : null,
        captured.nodeName ? `node=${captured.nodeName}` : null,
        captured.note || null,
      ].filter(Boolean);

      const resolvedName =
        (typeof fileName === "string" && fileName.trim()) ||
        captured.fileName ||
        derivePdfNameFromUrl(__u);

      const finalName = sanitizeName(
        resolvedName.toLowerCase().endsWith(".pdf")
          ? resolvedName
          : `${resolvedName}.pdf`,
      );

      const fileRec = await persistFile(
        captured.buffer,
        finalName,
        `Institutional PDF capture from ${url}`,
        folderId || null,
        {
          captureType: "URL_PDF",
          sourceUrl: captured.finalUrl || url,
          urlId: typeof urlId === "number" ? urlId : null,
          requestId: (req as any).requestId ?? null,
          captureMeta: {
            method: "institutional_node",
            capturedUrl: captured.finalUrl || url,
            contentType: captured.mimeType || "application/pdf",
            bytes: captured.buffer.byteLength,
            notes: noteBits.join(" • "),
          },
        },
      );

      return finalizeCapturedFile(fileRec, urlId, req, res);
    }

    const __allowed = await isRobotsAllowed(__u.toString());
    if (!__allowed) {
      return res.status(403).json({ message: "Blocked by robots.txt" });
    }
    log.info("crawlPdfHandler_begin", { ...requestMeta(req), url });

    // --------- Guardrails END ---------

    let pdfProbe: Awaited<ReturnType<typeof probeUrlKind>> | null = null;
    let requireOriginalPdf = looksLikePdfUrl(__u);

    try {
      pdfProbe = await probeUrlKind(__u.toString());
      if (pdfProbe.kind === "pdf") requireOriginalPdf = true;
    } catch (e) {
      log.info("crawl_pdf_probe_failed", {
        ...requestMeta(req),
        url,
        error: String((e as any)?.message || e),
      });
    }

    // Common post-processing (copy URL tags + maybe schedule ai-tag + respond)
    const postProcessAndRespond = async (fileRec: any) => {
      return finalizeCapturedFile(fileRec, urlId, req, res);
    };

    // ===== Fast-path: try DIRECT PDF bytes (handles SCI wrapper URLs via filename=...) =====
    try {
      const direct = resolveWrappedPdfToDirect(__u);

      const candidates = Array.from(
        new Set(
          [
            pdfProbe?.kind === "pdf" ? pdfProbe.finalUrl : null,
            direct && direct !== url ? direct : null,
            url,
          ].filter((v): v is string => Boolean(v)),
        ),
      );

      for (const candidate of candidates) {
        let cu: URL;
        try {
          cu = new URL(candidate);
        } catch {
          continue;
        }

        const likelyPdf = looksLikePdfUrl(cu);
        let isPdf = likelyPdf;

        // For obvious .pdf URLs, do not depend on a fragile Range sniff first.
        if (!likelyPdf) {
          try {
            const sniff = await fetchWithTimeout(candidate, 30_000, {
              Range: "bytes=0-4095",
              Accept: "application/pdf,*/*;q=0.9,text/html;q=0.8,*/*;q=0.7",
              "User-Agent": BROWSER_UA,
              "Accept-Language": "en-US,en;q=0.9",
              Referer: `${cu.origin}/`,
            });

            const sniffCt = (
              sniff.headers.get("content-type") || ""
            ).toLowerCase();
            const sniffBuf = Buffer.from(await sniff.arrayBuffer());

            isPdf =
              likelyPdf ||
              sniffCt.includes("application/pdf") ||
              isPdfMagic(sniffBuf);
          } catch (e) {
            log.info("crawl_pdf_direct_sniff_failed", {
              ...requestMeta(req),
              url,
              candidate,
              error: String((e as any)?.message || e),
            });

            // Important: do NOT abort the whole direct-download block.
            continue;
          }
        }

        if (!isPdf) continue;

        let full: Awaited<ReturnType<typeof fetchWithTimeout>>;
        try {
          full = await fetchWithTimeout(candidate, 120_000, {
            Accept: "application/pdf,*/*",
            "User-Agent": BROWSER_UA,
            "Accept-Language": "en-US,en;q=0.9",
            Referer: `${cu.origin}/`,
          });
        } catch (e) {
          log.info("crawl_pdf_full_fetch_failed", {
            ...requestMeta(req),
            url,
            candidate,
            error: String((e as any)?.message || e),
          });
          continue;
        }

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
            captureMeta: {
              method: "direct_fetch",
              capturedUrl: candidate,
              contentDisposition: cd,
              contentType: full.headers.get("content-type"),
              bytes: pdfBytes.length,
            },
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

    // ===== Secondary fast-path: wget IPv4 fallback for direct PDFs =====
    try {
      const direct = resolveWrappedPdfToDirect(__u);

      const candidates = Array.from(
        new Set(
          [
            pdfProbe?.kind === "pdf" ? pdfProbe.finalUrl : null,
            direct && direct !== url ? direct : null,
            url,
          ].filter((v): v is string => Boolean(v)),
        ),
      );

      for (const candidate of candidates) {
        let cu: URL;
        try {
          cu = new URL(candidate);
        } catch {
          continue;
        }

        const dl = await downloadPdfWithWget(candidate, {
          referer: `${cu.origin}/`,
          cookie: null,
        });

        if (!dl) continue;

        const derivedName = bestPdfFileName(cu, dl.cd);
        const finalName = sanitizeName((fileName as string) || derivedName);

        const desc =
          candidate === url
            ? `Original PDF from ${url}`
            : `Original PDF (resolved from wrapper) from ${url}`;

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
              method: "direct_fetch",
              capturedUrl: candidate,
              contentDisposition: dl.cd,
              contentType: dl.ct,
              bytes: dl.bytes.length,
              notes: "wget_ipv4_fallback",
            },
          },
        );

        log.info("crawl_pdf_wget_direct_download_done", {
          ...requestMeta(req),
          url,
          resolvedUrl: candidate,
          bytes: dl.bytes.length,
          fileId: fileRec.id,
        });

        return await postProcessAndRespond(fileRec);
      }
    } catch (e) {
      log.info("crawl_pdf_wget_direct_download_fallback", {
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

              const rt = String(
                (resp.request?.() as any)?.resourceType?.() || "",
              ).toLowerCase();
              const rtPdfish =
                rt === "xhr" ||
                rt === "fetch" ||
                rt === "document" ||
                rt === "iframe" ||
                rt === "other" ||
                rt === "media";

              // If headers already say it's a PDF, trust that immediately.
              // Only use URL + resource type as a fallback heuristic.
              const maybePdf = ctPdfish || cdPdfish || (urlPdfish && rtPdfish);
              if (!maybePdf) return;

              const bytes = await (resp as any).buffer();
              if (!bytes || bytes.length < 1024) return;

              /// configurable cap (large public PDFs are common in regulatory/government workflows)
              if (bytes.length > PDF_INTERCEPT_MAX_BYTES) return;

              if (!isPdfMagic(bytes)) return;

              finish({ bytes, pdfUrl: respUrl, cd });
            } catch {
              // ignore
            }
          });

          setTimeout(() => {
            log.info("crawl_pdf_intercept_timeout", {
              ...requestMeta(req),
              url,
            });
            finish(null);
          }, 45_000);
        });

        const { reader = true } = req.body || {};

        const forceLiveForPdfLikeUrl = looksLikePdfUrl(__u);
        const useReader = forceLiveForPdfLikeUrl ? false : reader;

        if (useReader) {
          try {
            await setReadableContentOnPage(page, url);
          } catch {
            await hardenLivePage(page, url);
            await navigateWithRetries(page, url, { pdfLike: false });
            await page.waitForSelector("body", { timeout: 30_000 } as any);
            await new Promise((r) => setTimeout(r, 700));
          }
        } else {
          try {
            await hardenLivePage(page, url);
            await navigateWithRetries(page, url, {
              pdfLike: forceLiveForPdfLikeUrl,
            });
          } catch (navErr) {
            log.info("crawl_pdf_navigation_error_continuing_intercept", {
              ...requestMeta(req),
              url,
              error: String((navErr as any)?.message || navErr),
            });
          }

          if (!forceLiveForPdfLikeUrl) {
            await page.waitForSelector("body", { timeout: 30_000 } as any);
            await new Promise((r) => setTimeout(r, 700));
          } else {
            // Let the response interception path catch the real PDF bytes.
            // Government / institutional servers can be slow — give them more time.
            await new Promise((r) => setTimeout(r, 8000));
          }
        }

        // ===== try to discover & fetch real PDFs linked/embedded on the page =====
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
        if (!hit) {
          log.info("crawl_pdf_intercept_no_pdf_response", {
            ...requestMeta(req),
            url,
          });
        }
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
              captureMeta: {
                method: "puppeteer_intercept",
                capturedUrl: hit.pdfUrl,
                contentDisposition: hit.cd,
                contentType: "application/pdf",
                bytes: hit.bytes.length,
              },
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

    if (requireOriginalPdf && DISABLE_PDF_SNAPSHOT_FALLBACK_FOR_PDF_URLS) {
      return res.status(422).json({
        code: "PDF_ORIGINAL_FETCH_REQUIRED",
        message:
          "Could not fetch the original PDF bytes for this PDF URL. Snapshot fallback was blocked because browser-printing PDF viewers often produces a black or blank single-page PDF.",
        url,
        probe: pdfProbe,
        hints: [
          "Verify the source URL is directly reachable from the backend container.",
          "If the site serves the PDF only after browser interaction, keep using the intercept path but increase PDF_INTERCEPT_MAX_BYTES for very large files.",
          "Avoid page-print fallback for PDF-like URLs unless you explicitly want a visual snapshot rather than the original document.",
        ],
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

    //Persist file
    const fileRec = await persistFile(
      pdfBuf,
      finalName,
      desc,
      folderId || null,
      {
        captureType: "URL_PDF",
        sourceUrl: url,
        urlId: typeof urlId === "number" ? urlId : null,
        captureMeta: {
          method: "page_print",
          capturedUrl: url,
          contentType: "application/pdf",
          bytes: Buffer.isBuffer(pdfBuf) ? pdfBuf.length : pdfBuf.byteLength,
          notes: "Browser page-print snapshot fallback",
        },
      },
    );

    log.info("crawl_pdf_done", { ...requestMeta(req), fileId: fileRec.id });
    return finalizeCapturedFile(fileRec, urlId, req, res);
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
