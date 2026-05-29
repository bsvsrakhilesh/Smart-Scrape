import { Router } from "express";
import axios from "axios";
import dns from "dns/promises";
import net from "net";

// Minimal in-memory cache. Good enough for favicons; avoids repeated outbound hits.
// NOTE: If you run multiple replicas, consider moving this to Redis.
type CacheEntry = {
  at: number;
  contentType: string;
  body: Buffer;
  etag?: string;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_CACHE_ENTRIES = 512;
const MAX_REDIRECTS = 3;

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // touch LRU-ish
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, entry: CacheEntry) {
  cache.set(key, entry);
  // naive LRU eviction
  while (cache.size > MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

function isPrivateIp(ip: string): boolean {
  // Handles IPv4 and IPv6
  if (net.isIP(ip) === 4) {
    const parts = ip.split(".").map((x) => parseInt(x, 10));
    const [a, b] = parts;

    // 10.0.0.0/8
    if (a === 10) return true;
    // 127.0.0.0/8 loopback
    if (a === 127) return true;
    // 169.254.0.0/16 link-local
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 0.0.0.0/8 and 100.64.0.0/10 (CGNAT) are also “not public”
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;

    return false;
  }

  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();

    // ::1 loopback
    if (normalized === "::1") return true;
    // fc00::/7 unique local addresses
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    // fe80::/10 link-local
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    )
      return true;

    return false;
  }

  return true; // unknown => treat as unsafe
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();

  // obvious local targets
  if (h === "localhost" || h.endsWith(".localhost")) return true;

  // internal/reserved-ish TLDs commonly used in corp networks
  const blockedSuffixes = [
    ".local",
    ".internal",
    ".intranet",
    ".corp",
    ".home",
    ".lan",
  ];
  if (blockedSuffixes.some((s) => h.endsWith(s))) return true;

  return false;
}

function hostnameFromHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
}

async function assertPublicHost(host: string) {
  const hostname = hostnameFromHost(host);

  if (isBlockedHostname(hostname)) {
    throw new Error("BLOCKED_HOST");
  }

  // If host is already an IP literal, block private ranges
  const ipType = net.isIP(hostname);
  if (ipType) {
    if (isPrivateIp(hostname)) throw new Error("BLOCKED_IP");
    return;
  }

  // Resolve A/AAAA and ensure none are private
  const results = await dns.lookup(hostname, { all: true });
  for (const r of results) {
    if (isPrivateIp(r.address)) {
      throw new Error("BLOCKED_DNS");
    }
  }
}

function safeHostFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    // Only allow http(s) targets (avoid file:, data:, etc.)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host;
  } catch {
    return null;
  }
}

async function fetchFavicon(host: string, ifNoneMatch?: string) {
  // Try the canonical location first. Many sites have it.
  let currentUrl = `https://${host}/favicon.ico`;

  let res;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const current = new URL(currentUrl);
    await assertPublicHost(current.host);

    res = await axios.get<ArrayBuffer>(currentUrl, {
      responseType: "arraybuffer",
      timeout: 8000,
      maxRedirects: 0,
      headers: {
        "User-Agent": "AQ-Governance-Collector/1.0 (+favicon)",
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
      },
      validateStatus: (s) =>
        (s >= 200 && s < 300) || s === 304 || (s >= 300 && s < 400),
    });

    if (res.status < 300 || res.status >= 400) break;

    const location = res.headers["location"];
    if (!location) break;

    const next = new URL(String(location), currentUrl);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error("BLOCKED_REDIRECT");
    }

    currentUrl = next.toString();
  }

  if (!res || (res.status >= 300 && res.status < 400)) {
    throw new Error("TOO_MANY_REDIRECTS");
  }

  return {
    status: res.status,
    contentType: (res.headers["content-type"] as string) || "image/x-icon",
    etag: res.headers["etag"] as string | undefined,
    body: Buffer.from(res.data),
  };
}

const router = Router();

// GET /api/favicon?url=https%3A%2F%2Fexample.com%2Ffoo
// Returns a same-origin favicon to keep CSP strict (img-src 'self').
router.get("/favicon", async (req, res) => {
  const raw = String(req.query.url || "");
  const host = safeHostFromUrl(raw);

  if (!host) {
    return res.status(400).json({ error: "Invalid url" });
  }

  try {
    await assertPublicHost(host);
  } catch {
    return res.status(400).json({ error: "Blocked host" });
  }

  const cacheKey = host.toLowerCase();
  const cached = cacheGet(cacheKey);

  // Conditional request support
  const inm = String(req.headers["if-none-match"] || "").trim();
  if (cached?.etag && inm && inm === cached.etag) {
    return res.status(304).end();
  }

  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    if (cached.etag) res.setHeader("ETag", cached.etag);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(cached.body);
  }

  try {
    const fetched = await fetchFavicon(cacheKey);

    // Some sites return HTML here; do a lightweight sanity check.
    const ct = (fetched.contentType || "").toLowerCase();
    if (!ct.startsWith("image/")) {
      return res.status(404).json({ error: "No favicon" });
    }

    const entry: CacheEntry = {
      at: Date.now(),
      contentType: fetched.contentType,
      body: fetched.body,
      etag: fetched.etag,
    };
    cacheSet(cacheKey, entry);

    res.setHeader("Content-Type", entry.contentType);
    if (entry.etag) res.setHeader("ETag", entry.etag);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(entry.body);
  } catch (error: any) {
    if (String(error?.message || "").startsWith("BLOCKED_")) {
      return res.status(400).json({ error: "Blocked host" });
    }
    return res.status(404).json({ error: "No favicon" });
  }
});

export default router;
