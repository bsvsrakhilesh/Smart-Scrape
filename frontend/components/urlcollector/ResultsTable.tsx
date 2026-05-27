import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUrlCollections } from "../../utils/collections";
import { SearchResult } from "../../lib/types";
import {
  apiUrl,
  urlsExists,
  saveCollectorPurposeSelection,
  type SaveUrlsRequestRow,
} from "../../lib/api";
import DownloadIcon from "../icons/DownloadIcon";
import { StaggerList, StaggerItem } from "../motion/StaggerList";
import { canonicalize as canonicalizeSaved, SAVED_KEY } from "../../utils/saved";

interface ResultsTableProps {
  results: SearchResult[];
  selectable?: boolean;
  selectedUrls?: Set<string>;
  onToggleRow?: (url: string) => void;
  onToggleFiltered?: (urls: string[], select: boolean) => void;
  onTogglePage?: (urls: string[], select: boolean) => void;
  onClearSelection?: () => void;
  onClear?: () => void;
  sortKey?: "original" | "title" | "domain" | "year";
  onSortChange?: (k: "original" | "title" | "domain" | "year") => void;
  collectorPurposeId: string;
  collectorPurposeTitle: string;
  collectorSearchId?: string | null;
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

/* ---------------- component ---------------- */

const ResultsTable: React.FC<ResultsTableProps> = ({
  results,
  selectable = true,
  selectedUrls = new Set<string>(),
  onToggleRow,
  onToggleFiltered,
  onTogglePage,
  onClearSelection,
  onClear,
  sortKey: sortKeyProp,
  onSortChange,
  collectorPurposeId,
  collectorPurposeTitle,
  collectorSearchId,
}) => {
  const navigate = useNavigate();
  // local selection if parent doesn't control it
  const [localSelected, setLocalSelected] = useState<Set<string>>(selectedUrls);
  const selected =
    onToggleRow || onTogglePage || onToggleFiltered
      ? selectedUrls
      : localSelected;

  const [isSaving, setIsSaving] = useState(false);
  const [rowSaving, setRowSaving] = useState<string | null>(null);
  const [rowSaved, setRowSaved] = useState<Record<string, boolean>>({});
  const [purposeStatus, setPurposeStatus] = useState<
    Record<string, "saved_to_purpose" | "added_to_purpose" | "already_in_purpose">
  >({});

  const [sortKeyLocal, setSortKeyLocal] = useState<SortKey>("original");
  const sortKey = (sortKeyProp ?? sortKeyLocal) as SortKey;
  const setSortKey = onSortChange ?? setSortKeyLocal;
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      // Backend unreachable -> fall back to local collections only
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
      const canon = canonicalizeSaved(r.url);
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

  const pageUrls = useMemo(
    () => pageRows.map((r) => r.url).filter(Boolean),
    [pageRows],
  );

  const filteredUrls = useMemo(
    () => filtered.map((r) => r.url).filter(Boolean),
    [filtered],
  );

  const selectedFilteredRows = useMemo(
    () => filtered.filter((r) => selected.has(r.url)),
    [filtered, selected],
  );

  const selectedFilteredCount = selectedFilteredRows.length;

  const selectedLoadedCount = useMemo(() => {
    const loadedUrls = new Set(results.map((r) => r.url).filter(Boolean));
    let count = 0;
    selected.forEach((url) => {
      if (loadedUrls.has(url)) count += 1;
    });
    return count;
  }, [results, selected]);

  const selectedHiddenCount = Math.max(
    0,
    selectedLoadedCount - selectedFilteredCount,
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
    if (pageUrls.length === 0) return false;
    for (const url of pageUrls) if (!selected.has(url)) return false;
    return true;
  }, [pageUrls, selected]);

  const allFilteredSelected = useMemo(() => {
    if (filteredUrls.length === 0) return false;
    for (const url of filteredUrls) if (!selected.has(url)) return false;
    return true;
  }, [filteredUrls, selected]);

  const toggleAll = () => {
    // Option A: header checkbox toggles ONLY current page rows (never global).
    const urls = pageUrls;
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

  const toggleFilteredSelection = () => {
    const urls = filteredUrls;
    if (urls.length === 0) return;

    const wantSelect = !allFilteredSelected;

    if (onToggleFiltered) return onToggleFiltered(urls, wantSelect);

    const next = new Set(localSelected);
    if (wantSelect) {
      urls.forEach((u) => next.add(u));
    } else {
      urls.forEach((u) => next.delete(u));
    }
    setLocalSelected(next);
  };

  const toggleRow = (url: string) => {
    if (onToggleRow) return onToggleRow(url);
    const next = new Set(localSelected);
    next.has(url) ? next.delete(url) : next.add(url);
    setLocalSelected(next);
  };

  const saveRowsToPurpose = async (rows: SaveUrlsRequestRow[]) => {
    if (!rows.length) return;
    setIsSaving(true);
    if (rows.length === 1) setRowSaving(rows[0].url);

    try {
      const response = await saveCollectorPurposeSelection(
        collectorPurposeId,
        rows,
        collectorSearchId,
      );
      const statuses = { ...purposeStatus };
      response.rows.forEach((row) => {
        const source = rows.find((candidate) => candidate.url === row.url);
        statuses[source?.url ?? row.url] = row.status;
      });
      setPurposeStatus(statuses);
      setRowSaved((previous) => {
        const next = { ...previous };
        rows.forEach((row) => {
          next[row.url] = true;
        });
        return next;
      });
      const newCount = response.rows.filter((row) => row.status === "saved_to_purpose").length;
      const linkedCount = response.rows.filter((row) => row.status === "added_to_purpose").length;
      const alreadyCount = response.rows.length - newCount - linkedCount;
      const detail = [
        newCount ? `${newCount} saved` : "",
        linkedCount ? `${linkedCount} added from library` : "",
        alreadyCount ? `${alreadyCount} already in purpose` : "",
      ].filter(Boolean).join(", ");
      pushNotice("success", `${collectorPurposeTitle}: ${detail}.`);
    } catch (error: any) {
      pushNotice("error", `Could not save to purpose: ${error?.message ?? "Unknown error"}`);
    } finally {
      setIsSaving(false);
      setRowSaving(null);
    }
  };

  const saveSelected = async () => {
    await saveRowsToPurpose(
      selectedFilteredRows.map((row) => ({
        url: row.url,
        title: row.title ?? row.url,
        snippet: row.snippet ?? "",
      })),
    );
  };

  const saveSingle = async (row: SearchResult) => {
    await saveRowsToPurpose([
      { url: row.url, title: row.title ?? row.url, snippet: row.snippet ?? "" },
    ]);
  };

  const exportSelected = () => {
    const rows =
      selectedFilteredCount > 0
        ? selectedFilteredRows
        : filtered;
    exportToCsv(
      rows,
      selectedFilteredCount > 0 ? "results_selected" : "results_filtered",
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

  /*
   * Library removal and capture operations now belong to Saved URLs.
   * Retained below temporarily as implementation history while the purpose flow stabilizes.
   *
  function describeDeleteTarget(result: SearchResult, collectionCount: number) {
    const label =
      result.title && result.title.trim() && result.title.trim() !== result.url
        ? `"${result.title.trim()}"`
        : result.url;

    const collectionClause =
      collectionCount > 0
        ? ` It will also be removed from ${collectionCount} collection${
            collectionCount === 1 ? "" : "s"
          }. Use "Remove from collection" instead if you only want to unassign it.`
        : "";

    return `${label} will be removed from the Saved URLs library.${collectionClause} Captured files and evidence snapshots already stored in File Manager will remain available, but this URL's saved-library entry, tags, notes, and favorites will be removed.`;
  }

  // Delete a saved URL record from the library (backend + local cache).
  const deleteFromLibrary = async (result: SearchResult) => {
    const rawUrl = result.url;
    const canon = canonicalizeSaved(rawUrl);
    const collectionCount = getUrlCollections(rawUrl).length;

    const confirmed = await confirm({
      title: "Delete from Saved URLs library?",
      description: describeDeleteTarget(result, collectionCount),
      confirmText: "Delete from library",
      cancelText: "Keep saved",
      danger: true,
    });

    if (!confirmed) return;

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

      // 3) Remove from all local collections
      reconcileUrlCollections(rawUrl);

      // 4) UI update
      setRowSaved((prev) => ({ ...prev, [rawUrl]: false }));
      pushNotice("success", "Deleted from the Saved URLs library.");

      // 5) Refresh backend set/map (in case multiple rows share same canonical)
      await refreshBackendSavedIndex(results);
    } catch (e: any) {
      pushNotice("error", `Could not remove: ${e?.message ?? "Unknown error"}`);
    } finally {
      setRowSaving(null);
    }
  };

  // Remove from a single collection
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

      pushNotice("info", "Removed from collection. The URL remains saved.");
      setRemovePickerOpen(false);
      setRemoveTargetUrl(null);
    } catch (e: any) {
      pushNotice(
        "error",
        `Could not remove from collection: ${e?.message ?? "Unknown error"}`,
      );
    }
  };

  const openPdfDiscovery = async (url: string, title: string) => {
    setCaptureBusy(url);
    const jobId = jobs?.startJob({
      kind: "pdf_discovery",
      title: "Prepare PDF harvest",
      targetLabel: title || url,
      stage: "saving-source-url",
      message: "Resolving source URL record",
      progressPct: 12,
      retryable: true,
      cancelable: false,
      onRetry: () => void openPdfDiscovery(url, title),
      meta: { url },
    });

    try {
      if (jobId) {
        jobs?.updateJob(jobId, {
          status: "running",
          stage: "saving-source-url",
          message: "Resolving source URL record",
          progressPct: 25,
          startedAt: new Date().toISOString(),
        });
      }
      const urlId = await ensureSavedUrlId(url, title);
      if (jobId) {
        jobs?.updateJob(jobId, {
          stage: "opening-drawer",
          message: "Opening PDF harvest drawer",
          progressPct: 80,
          meta: { url, urlId },
        });
      }
      setPdfDiscoveryTarget({ urlId, url, title });
      if (jobId) {
        jobs?.succeedJob(jobId, "PDF harvest ready", {
          meta: { url, urlId },
        });
      }
    } catch (e: any) {
      pushNotice(
        "error",
        `Could not start PDF harvest: ${e?.message ?? "Unknown error"}`,
      );
      if (jobId) {
        jobs?.failJob(jobId, e, {
          message: "Could not start PDF harvest",
        });
      }
    } finally {
      setCaptureBusy(null);
    }
  };

  // open modal to choose destination + filename, or harvest child PDFs first
  const openCapture = (
    mode: "text" | "pdf",
    url: string,
    title: string,
    result?: SearchResult,
  ) => {
    const row = result ?? results.find((r) => r.url === url);
    if (mode === "pdf" && row && !isDirectPdfSearchResult(row)) {
      void openPdfDiscovery(url, title);
      return;
    }

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

  type CaptureRunInput = {
    url: string;
    title: string;
    folderId?: string | null;
    fileName: string;
    mode: "text" | "pdf";
    accessMode?: "public" | "institutional";
  };

  const runCaptureJob = async (input: CaptureRunInput) => {
    const { url, title, folderId, fileName, mode, accessMode = "public" } =
      input;
    const controller = new AbortController();
    const jobId = jobs?.startJob({
      kind: "capture",
      title: mode === "pdf" ? "Capture PDF" : "Capture text",
      targetLabel: title || url,
      stage: "saving-source-url",
      message: "Saving source URL before capture",
      progressPct: 8,
      retryable: true,
      cancelable: true,
      onRetry: () => void runCaptureJob(input),
      onCancel: () => controller.abort(),
      meta: { url, mode, accessMode },
    });

    setCaptureBusy(url);
    try {
      if (jobId) {
        jobs?.updateJob(jobId, {
          status: "running",
          stage: "saving-source-url",
          message: "Resolving saved URL record",
          progressPct: 18,
          startedAt: new Date().toISOString(),
        });
      }

      const urlId = await ensureSavedUrlId(url, title);

      if (jobId) {
        jobs?.updateJob(jobId, {
          stage: mode === "pdf" ? "capturing-pdf" : "capturing-text",
          message:
            mode === "pdf"
              ? "Rendering or downloading PDF"
              : "Extracting readable text",
          progressPct: 45,
          meta: { url, urlId, mode, accessMode },
        });
      }

      const saved =
        mode === "text"
          ? await crawlSaveText(
              url,
              folderId ?? undefined,
              fileName,
              urlId,
              accessMode,
              { signal: controller.signal },
            )
          : await crawlSavePdf(
              url,
              folderId ?? undefined,
              fileName,
              true,
              true,
              urlId,
              accessMode,
              undefined,
              { signal: controller.signal },
            );

      if (jobId) {
        jobs?.updateJob(jobId, {
          stage: "finalizing",
          message: "Finalizing captured file",
          progressPct: 88,
        });
      }

      const method = saved?.captureMeta?.method
        ? `via ${saved.captureMeta.method}`
        : "";
      const src = saved?.captureMeta?.capturedUrl
        ? ` â€¢ ${saved.captureMeta.capturedUrl}`
        : "";
      const msg = `Captured ${method}${src}`.replace(/\s+/g, " ").trim();

      pushNotice(
        "success",
        `${msg || "Captured and saved successfully."}${
          accessMode === "institutional" ? " Routed via IIT session." : ""
        }`,
      );

      if (jobId) {
        jobs?.succeedJob(jobId, msg || "Captured and saved successfully.", {
          meta: {
            url,
            urlId,
            mode,
            accessMode,
            fileId: saved?.id,
            fileName: saved?.title,
          },
        });
      }
    } catch (e: any) {
      if (isAbortLike(e)) {
        if (jobId) jobs?.cancelJob(jobId, "Capture canceled");
      } else {
        console.error(e);
        const msg = e?.message ?? "Unknown error";
        pushNotice("error", `Capture failed: ${msg}`);
        if (jobId) {
          jobs?.failJob(jobId, msg, {
            message: "Capture failed",
            meta: { url, mode, accessMode },
          });
        }
      }
    } finally {
      setCaptureBusy(null);
    }
  };

  // confirm + call backend to persist capture
  const onConfirmCapture = async (opts: {
    folderId?: string | null;
    fileName: string;
    mode: "text" | "pdf";
    accessMode?: "public" | "institutional";
  }) => {
    setPickerOpen(false);
    await runCaptureJob({
      ...opts,
      url: pickerTarget.url,
      title: pickerTarget.title,
    });
  };

  */
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
                {selectable && selectedLoadedCount > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {selectedFilteredCount > 0
                      ? `${selectedFilteredCount} selected in view`
                      : "Selection outside current view"}
                  </span>
                )}
                {selectable && selectedHiddenCount > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {selectedHiddenCount} outside current filters
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
                  (page: {pageRows.length}, filtered: {filtered.length}, loaded:{" "}
                  {results.length})
                </span>

                {(onToggleFiltered || !onToggleRow) && (
                  <button
                    type="button"
                    onClick={toggleFilteredSelection}
                    className="underline opacity-80 hover:opacity-100"
                    title={
                      allFilteredSelected
                        ? "Clear the selection for rows in the current filtered view"
                        : "Select every row in the current filtered view"
                    }
                  >
                    {allFilteredSelected
                      ? `Clear filtered selection (${filtered.length})`
                      : `Select all filtered (${filtered.length})`}
                  </button>
                )}

                {onClearSelection && selectedLoadedCount > 0 && (
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
              disabled={selectedFilteredCount === 0 || isSaving}
              className="btn-primary rounded-full px-4 py-2 disabled:opacity-60"
              title={
                selectedFilteredCount > 0
                  ? `Save ${selectedFilteredCount} selected row${
                      selectedFilteredCount === 1 ? "" : "s"
                    } to ${collectorPurposeTitle}`
                  : selectedHiddenCount > 0
                    ? "Selected rows exist, but they are outside the current filters"
                    : "Select rows to save to this purpose"
              }
            >
              {isSaving
                ? "Saving…"
                : `Save to purpose (${selectedFilteredCount || 0})`}
            </button>
          )}

          <button
            onClick={exportSelected}
            className="btn-ghost px-4 py-2"
            title={
              selectedFilteredCount > 0
                ? `Export ${selectedFilteredCount} selected row${
                    selectedFilteredCount === 1 ? "" : "s"
                  } from the current view`
                : "Export the current filtered results as CSV"
            }
          >
            <DownloadIcon className="h-5 w-5" />
            <span className="hidden sm:inline">
              {selectedFilteredCount > 0 ? "Export selected CSV" : "Export filtered CSV"}
            </span>
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
          const collectionCount = getUrlCollections(r.url).length;
          const detectedYear = getResultYear(r);
          const savedToPurpose = purposeStatus[r.url];
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

                    {collectionCount > 0 && (
                      <span
                        className="ml-1 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        title="This URL is assigned to collections"
                      >
                        {collectionCount} collection
                        {collectionCount === 1 ? "" : "s"}
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
                  {!savedToPurpose ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        saveSingle(r);
                      }}
                      disabled={rowSaving === r.url}
                      className="btn-primary px-3 py-1.5 rounded-full"
                      title={`Save to ${collectorPurposeTitle}`}
                    >
                      {rowSaving === r.url ? (
                        "Saving…"
                      ) : (
                        <>
                          <SaveIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">
                            {isSaved ? "Add to purpose" : "Save to purpose"}
                          </span>
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
                        <span className="hidden sm:inline">
                          {savedToPurpose === "added_to_purpose"
                            ? "Added to purpose"
                            : savedToPurpose === "already_in_purpose"
                              ? "Already in purpose"
                              : "Saved to purpose"}
                        </span>
                      </span>

                      {/*
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openRemoveFromCategory(r.url);
                          }}
                          className="btn-ghost px-3 py-1.5"
                          title="Remove from a collection while keeping the URL saved"
                        >
                          <TagOffIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">
                            Remove from collection
                          </span>
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteFromLibrary(r);
                        }}
                        disabled={rowSaving === r.url}
                        className="btn-ghost px-3 py-1.5 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                        title="Delete this URL from the Saved URLs library"
                      >
                        {rowSaving === r.url ? (
                          <SpinnerMini />
                        ) : (
                          <TrashIcon className="h-4 w-4" />
                        )}
                        <span className="hidden sm:inline">Delete</span>
                      </button>*/}
                    </div>
                  )}

                  {/*
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
                            r,
                          );
                        }}
                        className="btn-primary px-3 py-1.5 rounded-full"
                        title={preferredTitle}
                      >
                        <DownloadIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">
                          {preferredLongLabel}
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
                            r,
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
                  </div>*/}

                  {isSaved && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/app/saved-urls?collectorPurposeId=${encodeURIComponent(collectorPurposeId)}`,
                        );
                      }}
                      className="btn-ghost px-3 py-1.5"
                    >
                      Open in Saved URLs
                    </button>
                  )}

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

      {/*
      <CollectionPickerModal
        isOpen={removePickerOpen}
        title="Remove from collection"
        collections={removeCollectionsForTarget}
        onCancel={onRemoveCancel}
        onConfirm={onRemoveConfirm}
      />

      <FolderPickerModal
        open={pickerOpen}
        suggestedName={suggestCollectorCaptureName(
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

      <PdfDiscoveryDrawer
        open={!!pdfDiscoveryTarget}
        sourceUrlId={pdfDiscoveryTarget?.urlId ?? null}
        sourceUrl={pdfDiscoveryTarget?.url ?? ""}
        sourceTitle={pdfDiscoveryTarget?.title ?? ""}
        query={searchQuery}
        autoDiscover
        jobs={jobs}
        onClose={() => setPdfDiscoveryTarget(null)}
      />
      */}
    </div>
  );
};

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