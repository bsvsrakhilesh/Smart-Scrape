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

type OpenLoginRequestBody = {
  url?: string | null;
  provider?: "openathens" | "proquest" | "nexis" | "pressreader" | "custom";
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
      return "https://www.lexisnexis.com/";
    case "pressreader":
      return "https://www.pressreader.com/";
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

  if (env.ICN_BROWSER_CHANNEL && !desiredHeadless) {
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
