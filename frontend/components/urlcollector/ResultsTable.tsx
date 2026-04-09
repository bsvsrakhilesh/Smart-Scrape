import React, { useEffect, useMemo, useRef, useState } from "react";
import CollectionPickerModal from "../savedurls/CollectionPickerModal";
import {
  addUrlToCollection,
  createCollection,
  getCollections,
  getUrlCollections,
  removeUrlFromCollection,
  reconcileUrlCollections,
  hydrateCollectionsFromBackend,
} from "../../utils/collections";
import { SearchResult } from "../../lib/types";
import {
  apiUrl,
  fetchSavedUrls,
  urlsExists,
  saveUrls,
  deleteUrlsBulk,
  type SaveUrlsRequestRow,
  type SaveUrlsResponse,
  crawlSavePdf,
  crawlSaveText,
} from "../../lib/api";
import DownloadIcon from "../icons/DownloadIcon";
import FolderPickerModal from "./FolderPickerModal";
import { StaggerList, StaggerItem } from "../motion/StaggerList";
import {
  canonicalize as canonicalizeSaved,
  removeSaved,
  SAVED_KEY,
} from "../../utils/saved";

interface ResultsTableProps {
  results: SearchResult[];
  selectable?: boolean;
  selectedUrls?: Set<string>;
  onToggleRow?: (url: string) => void;
  onToggleAll?: () => void;
  onTogglePage?: (urls: string[], select: boolean) => void;
  onClearSelection?: () => void;
  onClear?: () => void;
  sortKey?: "original" | "title" | "domain" | "year";
  onSortChange?: (k: "original" | "title" | "domain" | "year") => void;
}

/* ---------------- helpers ---------------- */

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

const nicePath = (url: string) => {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || "/");
    const short = p.length > 48 ? p.slice(0, 45) + "…" : p || "/";
    return short + (u.search ? "…" : "");
  } catch {
    return url;
  }
};

const favicon = (url: string) =>
  apiUrl(`/api/favicon?url=${encodeURIComponent(url)}`);

const YEAR_RE = /\b(19|20)\d{2}\b/g;

function extractYears(raw: string): number[] {
  const hits = String(raw || "").match(YEAR_RE) || [];
  return hits
    .map((v) => Number(v))
    .filter((y) => Number.isFinite(y) && y >= 1900 && y <= 2100);
}

function getResultYear(result: SearchResult): number | null {
  const titleSnippetYears = extractYears(
    `${result.title ?? ""} ${result.snippet ?? ""}`,
  );

  if (titleSnippetYears.length) {
    return Math.max(...titleSnippetYears);
  }

  const urlYears = extractYears(result.url ?? "");
  if (urlYears.length) {
    return Math.max(...urlYears);
  }

  return null;
}

function sortDirectionLabel(sortKey: SortKey, dir: SortDir): string {
  if (sortKey === "year") {
    return dir === "asc" ? "Oldest first" : "Newest first";
  }
  return dir === "asc" ? "A→Z" : "Z→A";
}

// Dedupe canonicalization (strip common tracking params)
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_reader",
  "utm_referrer",
  "gclid",
  "fbclid",
  "igshid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
]);

const canonicalUrl = (raw: string) => {
  try {
    const u = new URL(raw);

    u.hash = "";
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));

    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === "http:" && u.port === "80") ||
      (u.protocol === "https:" && u.port === "443")
    ) {
      u.port = "";
    }

    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    const params = Array.from(u.searchParams.entries());
    params.sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    params.forEach(([k, v]) => u.searchParams.append(k, v));

    return u.toString();
  } catch {
    return raw;
  }
};

function exportToCsv(rows: SearchResult[], filename = "results") {
  const headers = ["title", "url", "snippet"];
  const esc = (v: any) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };
  const body = rows
    .map((r) => [r.title, r.url, r.snippet ?? ""].map(esc).join(","))
    .join("\r\n");
  const csv = [headers.join(","), body].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type SavedFilter = "all" | "saved" | "unsaved";
type SortKey = "original" | "title" | "domain" | "year";
type SortDir = "asc" | "desc";

const DOC_TYPE_LABELS: Record<string, string> = {
  court_order: "Court order",
  notification: "Notification",
  report: "Report",
  news_article: "News article",
  parliamentary_material: "Parliament",
  affidavit_filing: "Affidavit / filing",
  guideline_circular: "Guideline / circular",
  official_document: "Official document",
  other: "Other",
};

const DOC_TYPE_BADGE: Record<string, string> = {
  court_order: "bg-violet-50 text-violet-700 border-violet-200",
  notification: "bg-amber-50 text-amber-700 border-amber-200",
  report: "bg-sky-50 text-sky-700 border-sky-200",
  news_article: "bg-rose-50 text-rose-700 border-rose-200",
  parliamentary_material: "bg-indigo-50 text-indigo-700 border-indigo-200",
  affidavit_filing: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  guideline_circular: "bg-emerald-50 text-emerald-700 border-emerald-200",
  official_document: "bg-teal-50 text-teal-700 border-teal-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
};

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-green-500",
  medium: "bg-amber-500",
  low: "bg-gray-400",
};

type CaptureMode = "text" | "pdf";

const PDF_FIRST_DOC_TYPES = new Set([
  "court_order",
  "notification",
  "report",
  "parliamentary_material",
  "affidavit_filing",
  "guideline_circular",
  "official_document",
]);

function inferPreferredCapture(result: SearchResult): CaptureMode {
  const docType = result.intelligence?.docType;

  if (docType) {
    return PDF_FIRST_DOC_TYPES.has(docType) ? "pdf" : "text";
  }

  const url = String(result.url || "").toLowerCase();
  if (/\.pdf(?:$|[?#])/.test(url) || /format=pdf/.test(url)) return "pdf";
  return "text";
}

function captureMeta(mode: CaptureMode) {
  return mode === "pdf"
    ? {
        shortLabel: "PDF",
        longLabel: "Capture PDF",
        title: "Capture this result as PDF",
      }
    : {
        shortLabel: "Text",
        longLabel: "Capture Text",
        title: "Capture this result as text",
      };
}

/* ---------------- component ---------------- */

const ResultsTable: React.FC<ResultsTableProps> = ({
  results,
  selectable = true,
  selectedUrls = new Set<string>(),
  onToggleRow,
  onToggleAll,
  onTogglePage,
  onClearSelection,
  onClear,
  sortKey: sortKeyProp,
  onSortChange,
}) => {
  // local selection if parent doesn't control it
  const [localSelected, setLocalSelected] = useState<Set<string>>(selectedUrls);
  const selected = onToggleRow || onToggleAll ? selectedUrls : localSelected;

  const [isSaving, setIsSaving] = useState(false);
  const [rowSaving, setRowSaving] = useState<string | null>(null);
  const [rowSaved, setRowSaved] = useState<Record<string, boolean>>({});

  const [sortKeyLocal, setSortKeyLocal] = useState<SortKey>("original");
  const sortKey = (sortKeyProp ?? sortKeyLocal) as SortKey;
  const setSortKey = onSortChange ?? setSortKeyLocal;
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Collection picker state (Save)
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collections, setCollections] = useState(getCollections());
  const [pendingRows, setPendingRows] = useState<SaveUrlsRequestRow[] | null>(
    null,
  );

  // Remove-from-collection picker state
  const [removePickerOpen, setRemovePickerOpen] = useState(false);
  const [removeTargetUrl, setRemoveTargetUrl] = useState<string | null>(null);

  // capture modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"text" | "pdf">("text");
  const [pickerTarget, setPickerTarget] = useState<{
    url: string;
    title: string;
  }>({ url: "", title: "" });
  const [captureBusy, setCaptureBusy] = useState<string | null>(null);

  // Dedupe toggle
  const [hideDuplicates, setHideDuplicates] = useState(true);

  // Filtering UI
  const [filterQuery, setFilterQuery] = useState("");
  const [filterDomain, setFilterDomain] = useState<"all" | string>("all");
  const [savedFilter, setSavedFilter] = useState<SavedFilter>("all");
  const [selectedOnly, setSelectedOnly] = useState(false);

  // Non-blocking notifications
  const [notice, setNotice] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const pushNotice = (type: "success" | "error" | "info", message: string) => {
    setNotice({ type, message });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  // Backend saved index (canonicalUrl -> id)
  const backendIdsRef = useRef<Record<string, number>>({});
  const backendSetRef = useRef<Set<string>>(new Set());

  const refreshBackendSavedIndex = async (
    rowsForRecalc: SearchResult[] = results,
  ) => {
    try {
      const urls = rowsForRecalc.map((r) => r.url).filter(Boolean);
      if (urls.length === 0) return;

      // Only check what we haven't cached yet
      const toCheck: string[] = [];
      for (const u of urls) {
        const c = canonicalizeSaved(u);
        if (!backendIdsRef.current[c]) toCheck.push(u);
      }

      if (toCheck.length) {
        const resp = await urlsExists(toCheck);
        const exists = resp?.exists ?? {};

        for (const [canon, id] of Object.entries(exists)) {
          const c = canonicalizeSaved(canon);
          backendIdsRef.current[c] = id;
          backendSetRef.current.add(c);
        }
      }

      // Update UI saved flags
      setRowSaved((prev) => {
        const next = { ...prev };
        for (const rr of rowsForRecalc) {
          const c = canonicalizeSaved(rr.url);
          next[rr.url] = backendSetRef.current.has(c);
        }
        return next;
      });
    } catch (e) {
      // Backend unreachable → fallback to local categories only
      setRowSaved((prev) => {
        const next = { ...prev };
        for (const rr of rowsForRecalc) {
          const inLocalCategory = getUrlCollections(rr.url).length > 0;
          next[rr.url] = prev[rr.url] || inLocalCategory;
        }
        return next;
      });
    }
  };

  // Initial sync + when results change
  useEffect(() => {
    if (typeof window === "undefined") return;
    refreshBackendSavedIndex(results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // Recompute saved states if local storage changes (other tabs/pages)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === "collections" ||
        e.key === "urlCollectionsByUrl" ||
        e.key === SAVED_KEY
      ) {
        refreshBackendSavedIndex(results);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const sorted = useMemo(() => {
    if (sortKey === "original") return results;

    const dir = sortDir === "asc" ? 1 : -1;

    const indexed = results.map((row, idx) => ({
      row,
      idx,
    }));

    indexed.sort((a, b) => {
      const aTitle = (a.row.title || "").toLowerCase();
      const bTitle = (b.row.title || "").toLowerCase();
      const aUrl = a.row.url || "";
      const bUrl = b.row.url || "";

      if (sortKey === "title") {
        if (aTitle === bTitle) return a.idx - b.idx;
        return aTitle.localeCompare(bTitle) * dir;
      }

      if (sortKey === "domain") {
        const aDomain = host(aUrl).toLowerCase();
        const bDomain = host(bUrl).toLowerCase();

        if (aDomain !== bDomain) {
          return aDomain.localeCompare(bDomain) * dir;
        }

        if (aTitle !== bTitle) {
          return aTitle.localeCompare(bTitle) * dir;
        }

        return a.idx - b.idx;
      }

      if (sortKey === "year") {
        const aYear = getResultYear(a.row);
        const bYear = getResultYear(b.row);

        // Always push missing years to the bottom
        if (aYear == null && bYear != null) return 1;
        if (aYear != null && bYear == null) return -1;
        if (aYear == null && bYear == null) return a.idx - b.idx;

        if (aYear !== bYear) {
          return ((aYear as number) - (bYear as number)) * dir;
        }

        if (aTitle !== bTitle) {
          return aTitle.localeCompare(bTitle);
        }

        return a.idx - b.idx;
      }

      return a.idx - b.idx;
    });

    return indexed.map((x) => x.row);
  }, [results, sortKey, sortDir]);

  // Dedupe + duplicate counters
  const { displayed, dupCountByUrl, duplicatesRemoved } = useMemo(() => {
    if (!hideDuplicates) {
      return {
        displayed: sorted,
        dupCountByUrl: {} as Record<string, number>,
        duplicatesRemoved: 0,
      };
    }

    const seen = new Map<string, string>(); // canonical -> first original url
    const dupCount: Record<string, number> = {};
    const out: SearchResult[] = [];

    for (const r of sorted) {
      const canon = canonicalUrl(r.url);
      const first = seen.get(canon);

      if (!first) {
        seen.set(canon, r.url);
        out.push(r);
      } else {
        dupCount[first] = (dupCount[first] ?? 0) + 1;
      }
    }

    return {
      displayed: out,
      dupCountByUrl: dupCount,
      duplicatesRemoved: sorted.length - out.length,
    };
  }, [sorted, hideDuplicates]);

  // Domain options derived from displayed list
  const domainOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of displayed) {
      const d = host(r.url) || "unknown";
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const arr = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([d, c]) => ({ d, c }));
    return arr;
  }, [displayed]);

  // Apply filters on top of displayed list
  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();

    return displayed.filter((r) => {
      const d = host(r.url) || "unknown";
      if (filterDomain !== "all" && d !== filterDomain) return false;

      const isSaved = !!rowSaved[r.url];
      if (savedFilter === "saved" && !isSaved) return false;
      if (savedFilter === "unsaved" && isSaved) return false;

      if (selectedOnly && !selected.has(r.url)) return false;

      if (q) {
        const hay =
          `${r.title ?? ""}\n${r.snippet ?? ""}\n${r.url}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    displayed,
    filterQuery,
    filterDomain,
    savedFilter,
    selectedOnly,
    selected,
    rowSaved,
  ]);

  // Pagination (10 per page)
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    [filtered.length],
  );
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(filtered.length, pageStart + PAGE_SIZE);
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + PAGE_SIZE),
    [filtered, pageStart],
  );

  // When filters/sort/dedupe change, jump back to page 1 so the user doesn't land on an empty page.
  useEffect(() => {
    setPage(1);
  }, [
    filterQuery,
    filterDomain,
    savedFilter,
    selectedOnly,
    sortKey,
    sortDir,
    hideDuplicates,
    results.length,
  ]);

  const allSelected = useMemo(() => {
    if (pageRows.length === 0) return false;
    for (const r of pageRows) if (!selected.has(r.url)) return false;
    return true;
  }, [pageRows, selected]);

  const toggleAll = () => {
    // Option A: header checkbox toggles ONLY current page rows (never global).
    const urls = pageRows.map((r) => r.url).filter(Boolean);
    if (urls.length === 0) return;

    const wantSelect = !allSelected;

    // Parent-controlled selection: delegate page-only toggle
    if (onTogglePage) return onTogglePage(urls, wantSelect);

    // Local selection fallback: still page-only
    if (wantSelect) {
      const next = new Set(localSelected);
      urls.forEach((u) => next.add(u));
      setLocalSelected(next);
    } else {
      const next = new Set(localSelected);
      urls.forEach((u) => next.delete(u));
      setLocalSelected(next);
    }
  };

  const toggleRow = (url: string) => {
    if (onToggleRow) return onToggleRow(url);
    const next = new Set(localSelected);
    next.has(url) ? next.delete(url) : next.add(url);
    setLocalSelected(next);
  };

  const saveSelected = async () => {
    if (selected.size === 0) return;

    const rows: SaveUrlsRequestRow[] = filtered
      .filter((r) => selected.has(r.url))
      .map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.snippet ?? "",
      }));

    if (rows.length === 0) {
      pushNotice("info", "No selected rows match current filters.");
      return;
    }

    await hydrateCollectionsFromBackend();
    setPendingRows(rows);
    setCollections(getCollections());
    setCollectionPickerOpen(true);
  };

  const saveSingle = async (r: SearchResult) => {
    if (rowSaved[r.url]) return;

    const rows: SaveUrlsRequestRow[] = [
      { url: r.url, title: r.title ?? r.url, snippet: r.snippet ?? "" },
    ];

    await hydrateCollectionsFromBackend();
    setPendingRows(rows);
    setCollections(getCollections());
    setCollectionPickerOpen(true);
  };

  const onPickCancel = () => {
    setCollectionPickerOpen(false);
    setPendingRows(null);
  };

  const onPickConfirm = async (collectionId: string) => {
    if (!pendingRows) return;
    setCollectionPickerOpen(false);

    const isSingle = pendingRows.length === 1;
    if (isSingle) setRowSaving(pendingRows[0].url);
    setIsSaving(true);

    try {
      const res: SaveUrlsResponse = await saveUrls(pendingRows);

      await Promise.all(
        pendingRows.map((r) =>
          addUrlToCollection(collectionId, r.url, {
            title: r.title,
            snippet: r.snippet,
          }),
        ),
      );

      setRowSaved((prev) => {
        const next = { ...prev };
        pendingRows.forEach((r) => (next[r.url] = true));
        return next;
      });

      pushNotice(
        "success",
        `Saved ${res.added} URL${res.added === 1 ? "" : "s"} (skipped ${res.skipped}).`,
      );

      await refreshBackendSavedIndex(results);
      setCollections(getCollections());
    } catch (e: any) {
      pushNotice(
        "error",
        `Failed to save URLs: ${e?.message ?? "Unknown error"}`,
      );
    } finally {
      setRowSaving(null);
      setIsSaving(false);
      setPendingRows(null);
    }
  };

  const exportSelected = () => {
    const rows =
      selected.size > 0
        ? filtered.filter((r) => selected.has(r.url))
        : filtered;
    exportToCsv(
      rows,
      selected.size > 0 ? "results_selected" : "results_filtered",
    );
    pushNotice(
      "info",
      `Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to CSV.`,
    );
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      pushNotice("info", "Copied URL to clipboard.");
    } catch {
      pushNotice("error", "Copy failed (clipboard not available).");
    }
  };

  // Remove Saved (backend + local categories)
  const unsaveUrl = async (rawUrl: string) => {
    const canon = canonicalizeSaved(rawUrl);

    setRowSaving(rawUrl);

    try {
      // 1) Remove from backend if we have an id
      let id = backendIdsRef.current[canon];
      if (!id) {
        await refreshBackendSavedIndex(results);
        id = backendIdsRef.current[canon];
      }
      if (id) {
        await deleteUrlsBulk([id]);
      }

      // 2) Remove from local “saved” list if present
      removeSaved(rawUrl);

      // 3) Remove from all local categories
      reconcileUrlCollections(rawUrl);

      // 4) UI update
      setRowSaved((prev) => ({ ...prev, [rawUrl]: false }));
      pushNotice("success", "Removed from Saved.");

      // 5) Refresh backend set/map (in case multiple rows share same canonical)
      await refreshBackendSavedIndex(results);
    } catch (e: any) {
      pushNotice("error", `Could not remove: ${e?.message ?? "Unknown error"}`);
    } finally {
      setRowSaving(null);
    }
  };

  // Remove from a single category
  const openRemoveFromCategory = async (url: string) => {
    await hydrateCollectionsFromBackend();
    setCollections(getCollections());
    setRemoveTargetUrl(url);
    setRemovePickerOpen(true);
  };

  const onRemoveCancel = () => {
    setRemovePickerOpen(false);
    setRemoveTargetUrl(null);
  };

  const onRemoveConfirm = async (collectionId: string) => {
    if (!removeTargetUrl) return;

    try {
      await removeUrlFromCollection(collectionId, removeTargetUrl);

      const canon = canonicalizeSaved(removeTargetUrl);
      const stillBackendSaved = backendSetRef.current.has(canon);
      const stillInAnyCategory = getUrlCollections(removeTargetUrl).length > 0;

      setRowSaved((prev) => ({
        ...prev,
        [removeTargetUrl]: stillBackendSaved || stillInAnyCategory,
      }));

      pushNotice("info", "Removed from category.");
      setRemovePickerOpen(false);
      setRemoveTargetUrl(null);
    } catch (e: any) {
      pushNotice(
        "error",
        `Could not remove from category: ${e?.message ?? "Unknown error"}`,
      );
    }
  };

  // open modal to choose destination + filename
  const openCapture = (mode: "text" | "pdf", url: string, title: string) => {
    setPickerMode(mode);
    setPickerTarget({ url, title });
    setPickerOpen(true);
  };

  // Ensure the URL exists in backend and return urlId (strong provenance for captures).
  const ensureSavedUrlId = async (url: string, title: string) => {
    const canon = canonicalizeSaved(url);
    const cached = backendIdsRef.current[canon];
    if (cached) return cached;

    const snippet = results.find((r) => r.url === url)?.snippet ?? "";

    // Idempotent: backend will return existing id for duplicates.
    const res = await saveUrls([{ url, title: title || url, snippet }]);

    // Preferred: backend returns ids directly
    const rows = (res as any)?.rows as
      | Array<{ id: number; url: string; isNew?: boolean }>
      | undefined;

    let id: number | undefined;

    if (rows && rows.length) {
      const hit =
        rows.find((r) => canonicalizeSaved(r.url) === canon) ??
        rows.find((r) => r.url === url);
      if (hit?.id) id = hit.id;
    }

    // Back-compat fallback (in case backend is older / misconfigured)
    if (!id) {
      const saved = await fetchSavedUrls();
      const hit = saved.find((r) => canonicalizeSaved(r.url) === canon);
      if (hit?.id) id = hit.id;
    }

    if (!id) throw new Error("Could not resolve urlId after saving URL.");

    backendIdsRef.current[canon] = id;
    backendSetRef.current.add(canon);

    // reflect saved status in UI
    setRowSaved((prev) => ({ ...prev, [url]: true }));

    return id;
  };

  // confirm + call backend to persist capture
  const onConfirmCapture = async (opts: {
    folderId?: string | null;
    fileName: string;
    mode: "text" | "pdf";
    accessMode?: "public" | "institutional";
  }) => {
    setPickerOpen(false);
    const { folderId, fileName, mode, accessMode = "public" } = opts;
    const url = pickerTarget.url;
    const title = pickerTarget.title;

    setCaptureBusy(url);
    try {
      // 1) Ensure URL row exists → get urlId
      const urlId = await ensureSavedUrlId(url, title);

      // 2) Capture with urlId (strong linkage URL → snapshot)
      const saved =
        mode === "text"
          ? await crawlSaveText(
              url,
              folderId ?? undefined,
              fileName,
              urlId,
              accessMode,
            )
          : await crawlSavePdf(
              url,
              folderId ?? undefined,
              fileName,
              true,
              true,
              urlId,
              accessMode,
            );

      const method = saved?.captureMeta?.method
        ? `via ${saved.captureMeta.method}`
        : "";
      const src = saved?.captureMeta?.capturedUrl
        ? ` • ${saved.captureMeta.capturedUrl}`
        : "";
      const msg = `Captured ${method}${src}`.replace(/\s+/g, " ").trim();

      pushNotice(
        "success",
        `${msg || "Captured and saved successfully."}${
          accessMode === "institutional" ? " Routed via IIT session." : ""
        }`,
      );
    } catch (e: any) {
      console.error(e);
      const msg = e?.message ?? "Unknown error";
      pushNotice("error", `Capture failed: ${msg}`);
    } finally {
      setCaptureBusy(null);
    }
  };

  const padY = "py-4";
  const titleSize = "text-[16px]";

  const filtersActive =
    filterQuery.trim() !== "" ||
    filterDomain !== "all" ||
    savedFilter !== "all" ||
    selectedOnly;

  const clearFilters = () => {
    setFilterQuery("");
    setFilterDomain("all");
    setSavedFilter("all");
    setSelectedOnly(false);
  };

  const removeCollectionsForTarget = useMemo(() => {
    if (!removeTargetUrl) return [];
    const ids = new Set(getUrlCollections(removeTargetUrl));
    return getCollections().filter((c) => ids.has(c.id));
  }, [removeTargetUrl]);

  return (
    <div className="w-full">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "mb-3 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            notice.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : notice.type === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-gray-200 bg-gray-50 text-gray-800",
          ].join(" ")}
        >
          <div className="min-w-0">{notice.message}</div>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium hover:bg-black/5"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="text-sm text-gray-600">
            {results.length ? (
              <>
                Showing{" "}
                <span className="font-medium text-gray-900">
                  {filtered.length === 0 ? 0 : pageStart + 1}-{pageEnd}
                </span>{" "}
                of{" "}
                <span className="font-medium text-gray-900">
                  {filtered.length}
                </span>
                {hideDuplicates && duplicatesRemoved > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    ({duplicatesRemoved} duplicate
                    {duplicatesRemoved === 1 ? "" : "s"} hidden)
                  </span>
                )}
                {selectable && selected.size > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {selected.size} selected
                  </span>
                )}
              </>
            ) : (
              "No results"
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              name="results-query"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-[260px] max-w-[70vw] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              placeholder="Search title, snippet, or URL…"
            />

            <select
              name="results-domain-filter"
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              title="Filter by domain"
            >
              <option value="all">All domains</option>
              {domainOptions.map((x) => (
                <option key={x.d} value={x.d}>
                  {x.d} ({x.c})
                </option>
              ))}
            </select>

            <select
              name="results-saved-filter"
              value={savedFilter}
              onChange={(e) => setSavedFilter(e.target.value as SavedFilter)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              title="Filter by saved status"
            >
              <option value="all">All</option>
              <option value="unsaved">Unsaved</option>
              <option value="saved">Saved</option>
            </select>

            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <input
                name="results-selected-only"
                type="checkbox"
                className="h-4 w-4"
                checked={selectedOnly}
                onChange={() => setSelectedOnly((v) => !v)}
              />
              Selected only
            </label>

            {filtersActive && (
              <button
                type="button"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onClear && (
              <button
                onClick={() => onClear?.()}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 transition"
                title="Clear searches"
              >
                Clear searches
              </button>
            )}

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
              <input
                name="results-hide-duplicates"
                type="checkbox"
                className="h-4 w-4"
                checked={hideDuplicates}
                onChange={() => setHideDuplicates((v) => !v)}
              />
              Hide duplicates
              {hideDuplicates && duplicatesRemoved > 0 && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  {duplicatesRemoved} removed
                </span>
              )}
            </label>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ListFilterIcon className="h-4 w-4 text-gray-500" />

              <select
                name="results-sort"
                value={sortKey}
                onChange={(e) => {
                  const next = e.target.value as SortKey;
                  setSortKey(next);

                  if (next === "original") {
                    setSortDir("asc");
                  } else if (next === "year") {
                    setSortDir("desc");
                  } else {
                    setSortDir("asc");
                  }
                }}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
                aria-label="Sort results"
              >
                <option value="original">AI relevance</option>
                <option value="year">Year (detected)</option>
                <option value="title">Title</option>
                <option value="domain">Domain</option>
              </select>

              {sortKey !== "original" && (
                <div
                  className="inline-flex overflow-hidden rounded-md border border-gray-200 bg-white"
                  role="group"
                  aria-label="Sort direction"
                >
                  <button
                    type="button"
                    onClick={() => setSortDir("asc")}
                    className={[
                      "px-3 py-1 text-xs font-medium transition",
                      sortDir === "asc"
                        ? "bg-green-50 text-green-700"
                        : "text-gray-700 hover:bg-gray-50",
                    ].join(" ")}
                    aria-pressed={sortDir === "asc"}
                    title={
                      sortKey === "year"
                        ? "Oldest documents first"
                        : "Ascending order"
                    }
                  >
                    {sortKey === "year" ? "Oldest first" : "A→Z"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSortDir("desc")}
                    className={[
                      "border-l border-gray-200 px-3 py-1 text-xs font-medium transition",
                      sortDir === "desc"
                        ? "bg-green-50 text-green-700"
                        : "text-gray-700 hover:bg-gray-50",
                    ].join(" ")}
                    aria-pressed={sortDir === "desc"}
                    title={
                      sortKey === "year"
                        ? "Newest documents first"
                        : "Descending order"
                    }
                  >
                    {sortKey === "year" ? "Newest first" : "Z→A"}
                  </button>
                </div>
              )}

              {sortKey !== "original" && (
                <span className="text-xs text-gray-500">
                  {sortDirectionLabel(sortKey, sortDir)}
                </span>
              )}
            </div>

            {selectable && filtered.length > 0 && (
              <div className="ml-1 flex flex-wrap items-center gap-3 text-sm text-gray-700">
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    name="results-page-select"
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                  Select this page
                </label>

                <span className="text-xs text-gray-500">
                  (page: {pageRows.length}, loaded: {filtered.length})
                </span>

                {/* Explicit global action (safe): selects all currently loaded results */}
                {onToggleAll && (
                  <button
                    type="button"
                    onClick={onToggleAll}
                    className="underline opacity-80 hover:opacity-100"
                    title="Select all currently loaded results (not unloaded pages)"
                  >
                    Select all loaded ({filtered.length})
                  </button>
                )}

                {onClearSelection && selected.size > 0 && (
                  <button
                    type="button"
                    onClick={onClearSelection}
                    className="underline opacity-80 hover:opacity-100"
                    title="Clear current selection"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectable && (
            <button
              onClick={saveSelected}
              disabled={selected.size === 0 || isSaving}
              className="btn-primary rounded-full px-4 py-2 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : `Save selected (${selected.size || 0})`}
            </button>
          )}

          <button onClick={exportSelected} className="btn-ghost px-4 py-2">
            <DownloadIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && totalPages > 1 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 text-sm">
          <div className="text-gray-600">
            Page <span className="font-medium text-gray-900">{safePage}</span>{" "}
            of <span className="font-medium text-gray-900">{totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage <= 1}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="First page"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Previous page"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Next page"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage >= totalPages}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Last page"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      <StaggerList as="ul" className="space-y-2 m-0 p-0">
        {pageRows.map((r, idx) => {
          const h = host(r.url);
          const isChecked = selected.has(r.url);
          const isSaved = !!rowSaved[r.url];
          const dupN = dupCountByUrl[r.url] ?? 0;
          const categoryCount = getUrlCollections(r.url).length;
          const detectedYear = getResultYear(r);

          const preferredCapture = inferPreferredCapture(r);
          const secondaryCapture: CaptureMode =
            preferredCapture === "pdf" ? "text" : "pdf";

          const preferredMeta = captureMeta(preferredCapture);
          const secondaryMeta = captureMeta(secondaryCapture);

          const recommendationText =
            preferredCapture === "pdf"
              ? "Recommended capture: PDF"
              : "Recommended capture: Text";

          return (
            <StaggerItem
              as="li"
              key={`${r.url}::${idx}`}
              onClick={(e: React.MouseEvent) => {
                const t = e.target as HTMLElement;
                if (t.closest("button, a, input, select, textarea, label"))
                  return;
                window.open(r.url, "_blank", "noopener,noreferrer");
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  !(e.target as HTMLElement).closest(
                    "button, a, input, select, textarea, label",
                  )
                ) {
                  e.preventDefault();
                  window.open(r.url, "_blank", "noopener,noreferrer");
                }
              }}
              role="link"
              tabIndex={0}
              className={[
                "group relative rounded-xl border border-gray-100 bg-white/80 backdrop-blur-sm",
                "hover:shadow-soft hover:-translate-y-[1px] hover:border-green-200/80 hover:bg-white",
                "transition-all duration-200 ease-out cursor-pointer",
              ].join(" ")}
            >
              <span className="absolute left-0 top-0 h-full w-[2px] rounded-l-xl bg-transparent group-hover:bg-green-400/90 group-hover:w-[3px] transition-all duration-200 ease-out" />

              <div
                className={[
                  "grid grid-cols-[auto,1fr,auto] items-start gap-3 px-3 sm:px-4",
                  padY,
                ].join(" ")}
              >
                {selectable ? (
                  <div className="pt-1">
                    <input
                      name="results-row-select"
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isChecked}
                      onChange={() => toggleRow(r.url)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${r.title || r.url}`}
                    />
                  </div>
                ) : (
                  <div />
                )}

                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`font-medium text-gray-900 hover:underline ${titleSize} leading-snug group/title`}
                      title={r.title || r.url}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.title || r.url}
                    </a>
                    <ExternalIcon className="mt-[2px] h-3.5 w-3.5 text-gray-400 opacity-0 transition-opacity group-hover/title:opacity-100" />
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700">
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 px-2 py-0.5">
                      <img
                        src={favicon(r.url)}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (
                            e.currentTarget as HTMLImageElement
                          ).style.visibility = "hidden";
                        }}
                      />
                      {h || "unknown"}
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-500">{nicePath(r.url)}</span>
                    </span>

                    {detectedYear && (
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-white/90 px-2 py-0.5">
                        Year {detectedYear}
                      </span>
                    )}

                    {r.intelligence?.docType && (
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                          DOC_TYPE_BADGE[r.intelligence.docType] ||
                            DOC_TYPE_BADGE.other,
                        ].join(" ")}
                        title={
                          r.intelligence.reason ||
                          "AI-assisted document type guess"
                        }
                      >
                        <span
                          className={[
                            "h-1.5 w-1.5 rounded-full",
                            CONFIDENCE_DOT[r.intelligence.confidence] ||
                              CONFIDENCE_DOT.low,
                          ].join(" ")}
                        />
                        {DOC_TYPE_LABELS[r.intelligence.docType] || "Other"}
                      </span>
                    )}

                    {dupN > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                        title="Other results were the same page with tracking parameters"
                      >
                        +{dupN} duplicate{dupN === 1 ? "" : "s"}
                      </span>
                    )}

                    {categoryCount > 0 && (
                      <span
                        className="ml-1 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        title="This URL is assigned to local categories"
                      >
                        {categoryCount} categor
                        {categoryCount === 1 ? "y" : "ies"}
                      </span>
                    )}
                  </div>

                  {r.snippet && (
                    <p className="mt-2 text-[13.5px] leading-6 text-gray-700 line-clamp-3">
                      {r.snippet}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                  {!isSaved ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        saveSingle(r);
                      }}
                      disabled={rowSaving === r.url}
                      className="btn-primary px-3 py-1.5 rounded-full"
                      title="Save URL"
                    >
                      {rowSaving === r.url ? (
                        "Saving…"
                      ) : (
                        <>
                          <SaveIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">Save</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-700"
                      >
                        <CheckIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">Saved</span>
                      </span>

                      {categoryCount > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openRemoveFromCategory(r.url);
                          }}
                          className="btn-ghost px-3 py-1.5"
                          title="Remove from a category"
                        >
                          <TagOffIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">Un-tag</span>
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          unsaveUrl(r.url);
                        }}
                        disabled={rowSaving === r.url}
                        className="btn-ghost px-3 py-1.5"
                        title="Remove from Saved"
                      >
                        {rowSaving === r.url ? (
                          <SpinnerMini />
                        ) : (
                          <TrashIcon className="h-4 w-4" />
                        )}
                        <span className="hidden sm:inline">Unsave</span>
                      </button>
                    </div>
                  )}

                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] font-medium text-gray-500">
                      {recommendationText}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openCapture(
                            preferredCapture,
                            r.url,
                            r.title || h || "page",
                          );
                        }}
                        className="btn-primary px-3 py-1.5 rounded-full"
                        title={preferredMeta.title}
                      >
                        <DownloadIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">
                          {preferredMeta.longLabel}
                        </span>
                        <span className="sm:hidden">
                          {preferredMeta.shortLabel}
                        </span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openCapture(
                            secondaryCapture,
                            r.url,
                            r.title || h || "page",
                          );
                        }}
                        className="btn-ghost px-3 py-1.5"
                        title={secondaryMeta.title}
                      >
                        <DownloadIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">
                          {secondaryMeta.shortLabel}
                        </span>
                        <span className="sm:hidden">
                          {secondaryMeta.shortLabel}
                        </span>
                      </button>

                      {captureBusy === r.url && (
                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 text-neutral-700">
                          <SpinnerMini /> Capturing…
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyUrl(r.url);
                    }}
                    className="btn-ghost px-3 py-1.5"
                    title="Copy URL"
                  >
                    <CopyIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              </div>
            </StaggerItem>
          );
        })}

        {results.length > 0 && filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-gray-300 bg-white/60 p-10 text-center">
            <div className="text-lg font-semibold text-gray-900">
              No matches
            </div>
            <div className="text-gray-600">
              Your filters removed all results. Try clearing filters.
            </div>
            <button
              type="button"
              className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </li>
        )}
      </StaggerList>

      {/* Save-to-category modal */}
      <CollectionPickerModal
        isOpen={collectionPickerOpen}
        title="Save to category"
        collections={collections}
        onCancel={onPickCancel}
        onConfirm={onPickConfirm}
        onRequestCreate={async () => {
          const name = window.prompt("Create category", "")?.trim();
          if (!name) return;

          try {
            await createCollection(name);
            await hydrateCollectionsFromBackend();
            setCollections(getCollections());
          } catch (e: any) {
            pushNotice(
              "error",
              `Could not create category: ${e?.message ?? "Unknown error"}`,
            );
          }
        }}
      />

      {/* Remove-from-category modal */}
      <CollectionPickerModal
        isOpen={removePickerOpen}
        title="Remove from category"
        collections={removeCollectionsForTarget}
        onCancel={onRemoveCancel}
        onConfirm={onRemoveConfirm}
      />

      <FolderPickerModal
        open={pickerOpen}
        suggestedName={suggestCaptureName(
          pickerTarget.url,
          pickerTarget.title,
          pickerMode,
        )}
        mode={pickerMode}
        showInstitutionalToggle={true}
        defaultAccessMode="public"
        onCancel={() => setPickerOpen(false)}
        onConfirm={onConfirmCapture}
      />
    </div>
  );
};

function suggestCaptureName(
  url: string,
  title: string | undefined,
  mode: "pdf" | "text",
) {
  const looksLikeUrlTitle = (t?: string) =>
    !!t && /^https?:\/\//i.test(t.trim());

  const fromUrl = (u: string) => {
    try {
      const U = new URL(u);

      // prefer query params containing ".pdf" (like sci.gov.in ?filename=...pdf)
      for (const [, v] of U.searchParams.entries()) {
        const s = String(v || "");
        if (s.toLowerCase().includes(".pdf")) {
          const base = s.split("/").pop() || "document.pdf";
          return decodeURIComponent(base);
        }
      }

      const base = decodeURIComponent(U.pathname.split("/").pop() || "");
      return base || U.hostname || "page";
    } catch {
      return "page";
    }
  };

  const raw =
    title && !looksLikeUrlTitle(title) ? title.trim() : fromUrl(url).trim();

  const stem = raw.replace(/\.(pdf|txt)$/i, "").slice(0, 60) || "page";
  return mode === "pdf" ? `${stem}.pdf` : `${stem}.txt`;
}

export default ResultsTable;

/* ---------------- tiny svg icons ---------------- */

function ExternalIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z"
      />
    </svg>
  );
}

function SaveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-2 6H7V7h8v2Z"
      />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="m9 16.2-3.5-3.6L4 14l5 5 11-11-1.5-1.5L9 16.2Z"
      />
    </svg>
  );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
      />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Z"
      />
    </svg>
  );
}

function TagOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M21 10.41V6a2 2 0 0 0-2-2h-4.41l-1.83-1.83A2 2 0 0 0 11.34 2H6a2 2 0 0 0-2 2v5.34a2 2 0 0 0 .59 1.42l9.24 9.24a2 2 0 0 0 2.83 0l3.34-3.34-1.41-1.41-3.34 3.34L6 9.34V4h5.34l1.83 1.83H19v4.17l2 2Zm-6.5-3.91a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"
      />
      <path fill="currentColor" d="M3 3l18 18-1.41 1.41L1.59 4.41 3 3Z" />
    </svg>
  );
}

function ListFilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M10 18v-2h10v2H10Zm-6-5v-2h16v2H4Zm3-5V6h13v2H7Z"
      />
    </svg>
  );
}

function SpinnerMini() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        opacity=".2"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
    </svg>
  );
}
