// Keep this logic aligned with backend/src/utils/urlCanonical.ts.
const DROP_EXACT_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
]);

export function canonicalizeUrl(input: string): string {
  let s = String(input || "").trim();
  if (!s) return "";

  if (/^\/\//.test(s)) {
    s = "https:" + s;
  } else if (!/^https?:\/\//i.test(s)) {
    const schemeLike = s.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:/);
    if (schemeLike && !/^\d+(?:[/?#]|$)/.test(s.slice(schemeLike[0].length))) {
      return "";
    }
    s = "https://" + s;
  }

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }

  u.hostname = u.hostname.toLowerCase().replace(/\.+$/, "");

  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }

  u.pathname = u.pathname.replace(/\/{2,}/g, "/");
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");

  for (const key of Array.from(u.searchParams.keys())) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("utm_") || DROP_EXACT_QUERY_KEYS.has(lowerKey)) {
      u.searchParams.delete(key);
    }
  }

  const sorted = new URLSearchParams();
  Array.from(u.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, v]) => sorted.append(k, v));
  u.search = sorted.toString() ? `?${sorted.toString()}` : "";

  u.hash = "";

  return u.toString();
}
