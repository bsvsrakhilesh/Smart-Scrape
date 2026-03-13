// backend/src/services/urlProbe.service.ts
// Production-grade URL probe: determines whether a URL is likely an HTML page or a PDF.
// - Uses SSRF guard (DNS resolve + private IP deny)
// - Uses HEAD first, falls back to a small Range GET when needed
// - Detects PDFs by Content-Type OR PDF magic bytes

import dns from "node:dns/promises";
import * as ipaddr from "ipaddr.js";

export type UrlKind = "pdf" | "html" | "unknown";

export type UrlProbeResult = {
  kind: UrlKind;
  finalUrl: string;
  contentType: string | null;
  contentDisposition: string | null;
  fileNameHint: string | null;
  method: "head" | "range";
  bytesSniffed?: number;
};

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
        "User-Agent": "SmartScrape/1.0",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(to);
  }
}

function isPdfMagic(buf: Buffer) {
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

function fileNameHintFromUrl(u: URL): string | null {
  const base = decodeURIComponent(u.pathname.split("/").pop() || "").trim();
  return base || null;
}

function normalizeKindFromContentType(ct: string | null): UrlKind {
  const s = (ct || "").toLowerCase();
  if (s.includes("application/pdf")) return "pdf";
  if (s.includes("text/html")) return "html";
  return "unknown";
}

export async function probeUrlKind(targetUrl: string): Promise<UrlProbeResult> {
  const u = new URL(targetUrl);
  await resolveAndGuard(u.hostname);

  // 1) HEAD probe
  try {
    const head = await fetchWithTimeout(targetUrl, 10_000, {
      method: "HEAD",
      headers: { Accept: "*/*" },
    });

    const ct = head.headers.get("content-type");
    const cd = head.headers.get("content-disposition");
    const finalUrl = head.url || targetUrl;
    const kindFromCt = normalizeKindFromContentType(ct);
    const fileNameHint =
      filenameFromContentDisposition(cd) ||
      fileNameHintFromUrl(new URL(finalUrl));

    if (kindFromCt !== "unknown") {
      return {
        kind: kindFromCt,
        finalUrl,
        contentType: ct,
        contentDisposition: cd,
        fileNameHint,
        method: "head",
      };
    }
  } catch {
    // ignore and fall through
  }

  // 2) Range probe
  const range = await fetchWithTimeout(targetUrl, 15_000, {
    method: "GET",
    headers: {
      Range: "bytes=0-2047",
      Accept: "*/*",
    },
  });

  const ct = range.headers.get("content-type");
  const cd = range.headers.get("content-disposition");
  const finalUrl = range.url || targetUrl;
  const buf = Buffer.from(await range.arrayBuffer());

  const magicPdf = isPdfMagic(buf);
  const kindFromCt = normalizeKindFromContentType(ct);
  const kind: UrlKind = magicPdf ? "pdf" : kindFromCt;
  const fileNameHint =
    filenameFromContentDisposition(cd) ||
    fileNameHintFromUrl(new URL(finalUrl));

  return {
    kind,
    finalUrl,
    contentType: ct,
    contentDisposition: cd,
    fileNameHint,
    method: "range",
    bytesSniffed: buf.length,
  };
}
