import { Router } from "express";
import axios from "axios";

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
  const url = `https://${host}/favicon.ico`;

  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 8000,
    maxRedirects: 3,
    headers: {
      "User-Agent": "AQ-Governance-Collector/1.0 (+favicon)",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
    },
    validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
  });

  return {
    status: res.status,
    contentType:
      (res.headers["content-type"] as string) || "image/x-icon",
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
  } catch {
    return res.status(404).json({ error: "No favicon" });
  }
});

export default router;
