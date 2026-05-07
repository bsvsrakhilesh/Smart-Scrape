import axios from "axios";
import { log, mask } from "../utils/logger";

const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";

export type GoogleSearchOpts = {
  site?: string; // domain or url (we normalize to host)
  yearFrom?: number;
  yearTo?: number;
  jurisdiction?: string; // AND constraint via hq
  region?: string; // AND constraint via hq
  fileType?: "pdf" | "html";
  excludeFileType?: "pdf";
  lr?: string; // e.g. lang_en
  cr?: string; // e.g. countryIN
  gl?: string; // e.g. IN
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHost(site: string): string {
  const s = site.trim();
  if (!s) return "";
  const withoutProto = s.replace(/^https?:\/\//i, "");
  return withoutProto.split("/")[0].trim();
}

function quoteIfNeeded(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const alreadyQuoted =
    (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  if (alreadyQuoted) return t;
  return t.includes(" ") ? `"${t}"` : t;
}

function sortRangeForYears(yearFrom?: number, yearTo?: number): string | undefined {
  const nowYear = new Date().getFullYear();
  let y1 = typeof yearFrom === "number" ? Math.trunc(yearFrom) : undefined;
  let y2 = typeof yearTo === "number" ? Math.trunc(yearTo) : undefined;

  if (!y1 && !y2) return undefined;
  if (!y1 && y2) y1 = y2;
  if (y1 && !y2) y2 = nowYear;
  if (!y1 || !y2) return undefined;

  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);

  // sort=date:r:YYYYMMDD:YYYYMMDD
  return `date:r:${lo}0101:${hi}1231`;
}

function deriveCountryParamFromJurisdiction(j?: string): { cr?: string; gl?: string } {
  const t = (j || "").trim();
  if (!t) return {};
  if (/^[a-z]{2}$/i.test(t)) {
    const cc = t.toUpperCase();
    return { cr: `country${cc}`, gl: cc };
  }
  return {};
}

export async function googleSearch(
  q: string,
  page: number = 1,
  opts: GoogleSearchOpts = {},
) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  if (!key || !cx) {
    const msg = "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX in environment";
    log.error("cse.env.missing", { msg });
    throw new Error(msg);
  }

  const safePage = Number.isFinite(page) ? Math.max(1, Math.min(10, page)) : 1;
  const start = (safePage - 1) * 10 + 1;

  const siteHost = opts.site ? normalizeHost(opts.site) : "";
  const derived = deriveCountryParamFromJurisdiction(opts.jurisdiction);
  const cr = opts.cr || derived.cr;
  const gl = opts.gl || derived.gl;

  // If we’re using siteSearch, strip matching `site:` operators from q to avoid double filtering.
  let qClean = (q || "").trim();
  if (siteHost) {
    const candidates = [
      siteHost,
      siteHost.replace(/^www\./i, ""),
      `www.${siteHost.replace(/^www\./i, "")}`,
    ]
      .filter(Boolean)
      .map((s) => s.toLowerCase());

    for (const c of Array.from(new Set(candidates))) {
      qClean = qClean.replace(
        new RegExp(`\\bsite:${escapeRegExp(c)}\\b\\s*`, "gi"),
        "",
      );
    }
    qClean = qClean.trim();
  }

  // AND constraints via `hq` (keeps user query semantics intact)
  const hqParts = [opts.jurisdiction, opts.region]
    .map((s) => (typeof s === "string" ? quoteIfNeeded(s) : ""))
    .filter(Boolean);
  const hq = hqParts.length ? hqParts.join(" ") : undefined;

  if (opts.excludeFileType === "pdf" && !/\b-filetype:pdf\b/i.test(qClean)) {
    qClean = [qClean, "-filetype:pdf"].filter(Boolean).join(" ");
  }

  const sort = sortRangeForYears(opts.yearFrom, opts.yearTo);

  const startedAt = Date.now();
  try {
    const resp = await axios.get(GOOGLE_CSE_URL, {
      params: {
        q: qClean,
        key,
        cx,
        num: 10,
        start,
        safe: "off",
        prettyPrint: false,

        ...(siteHost ? { siteSearch: siteHost, siteSearchFilter: "i" } : {}),
        ...(opts.fileType ? { fileType: opts.fileType } : {}),
        ...(opts.lr ? { lr: opts.lr } : {}),
        ...(cr ? { cr } : {}),
        ...(gl ? { gl } : {}),
        ...(hq ? { hq } : {}),
        ...(sort ? { sort } : {}),
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const items: any[] = Array.isArray(resp?.data?.items) ? resp.data.items : [];
    const results = items.map((item: any) => ({
      title: item?.title ?? "",
      url: item?.link ?? "",
      snippet: item?.snippet ?? "",
    }));

    const nextStart: unknown = resp?.data?.queries?.nextPage?.[0]?.startIndex;
    const nextPageCandidate =
      typeof nextStart === "number" ? Math.floor((nextStart - 1) / 10) + 1 : null;

    const nextPage =
      typeof nextPageCandidate === "number" &&
      nextPageCandidate >= 1 &&
      nextPageCandidate <= 10 &&
      nextPageCandidate > safePage
        ? nextPageCandidate
        : null;

    const totalRaw: unknown = resp?.data?.searchInformation?.totalResults;
    const totalResults =
      typeof totalRaw === "string"
        ? Number(totalRaw)
        : typeof totalRaw === "number"
          ? totalRaw
          : null;

    log.info("cse.search.ok", {
      query: qClean,
      hq,
      siteSearch: siteHost || undefined,
      fileType: opts.fileType,
      excludeFileType: opts.excludeFileType,
      lr: opts.lr,
      cr,
      gl,
      sort,
      cx: mask(cx),
      page: safePage,
      start,
      status: resp.status,
      items_count: results.length,
      nextPage,
      totalResults,
      ms: Date.now() - startedAt,
    });

    return { results, nextPage, totalResults };
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const reason = data?.error?.message || err.message || "CSE request failed";

    let hint = "";
    if (status === 403) hint = "check key/cx validity and daily quota";
    else if (status === 400) hint = "check your query/cx or filter params";

    log.error("cse.search.fail", {
      query: q,
      hq,
      siteSearch: siteHost || undefined,
      excludeFileType: opts.excludeFileType,
      status,
      reason,
      hint,
      ms: Date.now() - startedAt,
    });

    throw new Error(
      `Google CSE error ${status ?? ""}: ${reason}${hint ? ` (${hint})` : ""}`,
    );
  }
}
