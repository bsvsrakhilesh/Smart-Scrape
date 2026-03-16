import axios from "axios";
import type { FileDetail, FileItem, SearchResult } from "./types";

const rawBase = (import.meta as any)?.env?.VITE_API_URL || "";

const isBrowser = typeof window !== "undefined";
const host = isBrowser ? window.location.hostname : "";
const isRemoteHost =
  isBrowser &&
  host &&
  host !== "localhost" &&
  host !== "127.0.0.1" &&
  host !== "::1";

const looksLikeLocalhost =
  typeof rawBase === "string" &&
  /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(rawBase);

const baseURL =
  typeof rawBase === "string" &&
  (rawBase.includes("://backend:") || (isRemoteHost && looksLikeLocalhost))
    ? ""
    : rawBase;

const api = axios.create({
  // Default: same-origin `/api` (dev proxy + prod nginx proxy)
  baseURL,
  withCredentials: true,
});

function normalizeApiError(err: any, fallback: string): never {
  const status = err?.response?.status;
  const body = err?.response?.data;
  const message =
    body?.message ||
    (Array.isArray(body?.hints) && body.hints.length
      ? `${fallback}: ${body.hints.join(" ")}`
      : null) ||
    (typeof body === "string" ? body : null) ||
    err?.message ||
    fallback;

  const code = body?.code ? ` [${body.code}]` : "";
  throw new Error(`${message}${status ? ` (HTTP ${status})` : ""}${code}`);
}

// Build an absolute URL that respects VITE_API_URL / axios baseURL.
// Safe for same-origin (baseURL="") and cross-origin (baseURL="https://host").
export function apiUrl(p: string) {
  const path = String(p || "");
  const b = String((api.defaults.baseURL as any) || "");

  if (!b) return path;

  // Avoid double "/api" if baseURL already ends with "/api" and path starts with "/api/.."
  const bNorm = b.endsWith("/") ? b.slice(0, -1) : b;
  if (bNorm.endsWith("/api") && path.startsWith("/api/")) {
    return bNorm + path.slice("/api".length);
  }

  if (bNorm.endsWith("/") && path.startsWith("/"))
    return bNorm.slice(0, -1) + path;
  if (!bNorm.endsWith("/") && !path.startsWith("/")) return bNorm + "/" + path;
  return bNorm + path;
}

// ---------- small helper: GET JSON via axios ----------
async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    const res = await api.get(path, {
      headers: { Accept: "application/json" },
      signal,
    });
    return res.data as T;
  } catch (err: any) {
    // Keep errors readable and consistent
    const status = err?.response?.status;
    const body = err?.response?.data;
    const text =
      typeof body === "string" ? body : body ? JSON.stringify(body) : "";
    throw new Error(
      `API GET ${status ?? "?"}: ${text || err?.message || "request failed"}`,
    );
  }
}

export type SearchWebOptions = {
  site?: string;
  yearFrom?: number;
  yearTo?: number;
  jurisdiction?: string;
  region?: string;
  fileType?: "pdf" | "html";
  lr?: string; // e.g. lang_en
  cr?: string; // e.g. countryIN
  gl?: string; // e.g. IN
};

// ---------- Web Search API (URL Collector) ----------
export async function searchWeb(
  q: string,
  page = 1,
  signal?: AbortSignal,
  opts?: SearchWebOptions,
): Promise<{
  rows: SearchResult[];
  nextPage: number | null;
  totalResults: number | null;
}> {
  try {
    const params: Record<string, any> = { q, page };
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        params[k] = v;
      }
    }

    const res = await api.get("/api/search", {
      params,
      headers: { Accept: "application/json" },
      signal,
    });

    const data = res.data as SearchResult[];
    const rows: SearchResult[] = Array.isArray(data)
      ? data.map((it) => ({
          title: it?.title ?? "(no title)",
          url: it?.url ?? "",
          snippet: it?.snippet ?? "",
        }))
      : [];

    const npRaw = res.headers?.["x-next-page"];
    const nextPage = npRaw ? Number(npRaw) : null;

    const totalRaw = res.headers?.["x-total-results"];
    const totalResults = totalRaw ? Number(totalRaw) : null;

    return { rows, nextPage, totalResults };
  } catch (err: any) {
    if (err?.code === "ERR_CANCELED") throw err;
    const status = err?.response?.status;
    if (status === 429) throw new Error("RATE_LIMITED");

    const body = err?.response?.data;
    const text =
      typeof body === "string" ? body : body ? JSON.stringify(body) : "";

    throw new Error(
      `Proxy error ${status ?? "?"}: ${text || err?.message || "request failed"}`,
    );
  }
}

export type BackendUrlRow = {
  id: number;
  url: string;
  title: string;
  snippet?: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorited?: boolean;
  notes?: string | null;
  tags?: string[] | null;
  taggingStatus?: "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  taggingJobId?: string | null;
  taggingError?: string | null;
  latestSnapshot?: {
    id: string;
    fileName: string;
    captureType: "UPLOAD" | "URL_TEXT" | "URL_PDF";
    createdAt: string;
    sha256?: string | null;
  } | null;
  contentHash?: string | null;
  taggerVersion?: string | null;
  tagsMeta?: any;
};

export type BackendStoredFile = {
  id: string;
  fileName: string;
  description?: string | null;
  uploaderName: string;
  uploaderId?: string | null;
  createdAt: string;
  mimeType: string;
  size: number;
  tags?: string[] | null;
  visibility?: string;
  downloads?: number;
  favoritesCount?: number;
  isFavorited?: boolean;
  folderId?: string | null;
  storagePath?: string;
  captureType?: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  sourceUrl?: string | null;
  urlId?: number | null;
  sha256?: string | null;
  tagsMeta?: any;
  contentHash?: string | null;
  taggerVersion?: string | null;
  taggingStatus?: "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  taggingJobId?: string | null;
  taggingError?: string | null;
  document?: any;
  documentRevision?: any;
  captureEvent?: any;
};

export function toFileItem(row: BackendStoredFile): FileItem {
  return {
    id: row.id,
    title: row.fileName || "Untitled",
    description: row.description || "",
    uploader: {
      id: row.uploaderId || "unknown",
      name: row.uploaderName || "Unknown",
    },
    uploadDate: row.createdAt,
    size: typeof row.size === "number" ? row.size : 0,
    mimeType: row.mimeType,
    thumbnailUrl: "",
    tags: (row.tags as string[] | undefined) || [],
    downloads: row.downloads ?? 0,
    favoritesCount: row.favoritesCount ?? 0,
    isFavorited: row.isFavorited ?? false,
    visibility: (row.visibility as any) || "private",
    captureType: row.captureType,
    sourceUrl: row.sourceUrl ?? null,
    urlId: row.urlId ?? null,
    sourcePublishedAt:
      (row as any).sourcePublishedAt ?? (row as any)?.url?.publishedAt ?? null,
    sourceAuthors:
      (row as any).sourceAuthors ?? (row as any)?.url?.authors ?? null,
    sha256: (row as any).sha256 ?? null,
    captureMeta: (row as any)?.tagsMeta?.capture ?? null,
    contentHash: (row as any)?.contentHash ?? null,
    taggerVersion: (row as any)?.taggerVersion ?? null,
    taggingStatus: (row as any)?.taggingStatus ?? "NONE",
    taggingJobId: (row as any)?.taggingJobId ?? null,
    taggingError: (row as any)?.taggingError ?? null,
    tagsMetaRaw: (row as any)?.tagsMeta ?? null,

    document: (row as any).document ?? null,
    documentRevision: (row as any).documentRevision ?? null,
    captureEvent: (row as any).captureEvent ?? null,
  };
}

export function normalizeFileDetail(input: any): FileDetail {
  if (!input || typeof input !== "object") {
    return {
      id: "",
      title: "Untitled",
      uploader: { id: "unknown", name: "Unknown" },
      uploadDate: new Date().toISOString(),
      size: 0,
      mimeType: "application/octet-stream",
      tags: [],
      visibility: "private",
    };
  }

  if ("uploadDate" in input && "title" in input && "uploader" in input) {
    return input as FileDetail;
  }

  if ("fileName" in input || "createdAt" in input || "uploaderName" in input) {
    const row = input as any;

    const base = toFileItem({
      id: String(row.id ?? ""),
      fileName: row.fileName ?? row.title ?? "Untitled",
      description: row.description ?? "",
      uploaderName: row.uploaderName ?? row.uploader?.name ?? "Unknown",
      uploaderId: row.uploaderId ?? row.uploader?.id ?? "unknown",
      createdAt: row.createdAt ?? row.uploadDate ?? new Date().toISOString(),
      mimeType: row.mimeType ?? "application/octet-stream",
      size: typeof row.size === "number" ? row.size : 0,
      tags: Array.isArray(row.tags) ? row.tags : [],
      visibility: row.visibility ?? "private",
      downloads: row.downloads,
      favoritesCount: row.favoritesCount,
      isFavorited: row.isFavorited,
      folderId: row.folderId,
      storagePath: row.storagePath,
      captureType: row.captureType,
      sourceUrl: row.sourceUrl,
      urlId: row.urlId,
      sha256: row.sha256,
      tagsMeta: row.tagsMeta,
      contentHash: row.contentHash,
      taggerVersion: row.taggerVersion,
      taggingStatus: row.taggingStatus,
      taggingJobId: row.taggingJobId,
      taggingError: row.taggingError,
    } as any);

    return {
      ...(row as any),
      ...(base as any),
      title: base.title,
      uploadDate: base.uploadDate,
      uploader: base.uploader,
      mimeType: base.mimeType,
      size: base.size,
      tags: base.tags,
      visibility: base.visibility,
    } as FileDetail;
  }

  // Unknown shape fallback: try to coerce.
  const id = String((input as any).id ?? "");
  const title = (input as any).title ?? (input as any).fileName ?? "Untitled";
  const uploadDate =
    (input as any).uploadDate ??
    (input as any).createdAt ??
    new Date().toISOString();

  const uploader =
    (input as any).uploader ??
    ({
      id: (input as any).uploaderId ?? "unknown",
      name: (input as any).uploaderName ?? "Unknown",
    } as any);

  return {
    ...(input as any),
    id,
    title,
    uploadDate: String(uploadDate),
    uploader,
    mimeType: (input as any).mimeType ?? "application/octet-stream",
    size: typeof (input as any).size === "number" ? (input as any).size : 0,
    tags: Array.isArray((input as any).tags) ? (input as any).tags : [],
    visibility: (input as any).visibility ?? "private",
  } as FileDetail;
}

// ---------- Saved URLs API ----------
export async function fetchSavedUrls(): Promise<BackendUrlRow[]> {
  const res = await api.get("/api/urls");
  return res.data;
}
export async function saveUrls(
  rows: { url: string; title: string; snippet?: string }[],
): Promise<SaveUrlsResponse> {
  const res = await api.post("/api/urls", { urls: rows });
  return res.data as SaveUrlsResponse;
}

export async function urlsExists(urls: string[]) {
  const res = await api.post("/api/urls/exists", { urls });
  return res.data as { exists: Record<string, number> };
}

export async function patchUrl(id: number, patch: any) {
  const res = await api.patch(`/api/urls/${id}`, patch);
  return res.data;
}
export async function getUrlById(id: number): Promise<BackendUrlRow> {
  const res = await api.get(`/api/urls/${id}`);
  return res.data as BackendUrlRow;
}

export async function refreshUrlMetadata(urlId: number): Promise<{
  id: number;
  publishedAt: string | null;
  authors: string[];
}> {
  const res = await api.post(`/api/urls/${urlId}/refresh-metadata`);
  return res.data;
}

export async function getUrlSnapshots(urlId: number, limit = 50) {
  const res = await api.get(`/api/urls/${urlId}/snapshots`, {
    params: { limit },
  });
  return res.data as BackendStoredFile[];
}

// ------------------------------
// Canonical Document Revisions
// ------------------------------

export type BackendDocumentRevision = {
  id: string;
  ordinal: number;
  createdAt: string;
  captureType: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  contentHash: string | null;
  storedFile: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string | null;
    createdAt: string;
    sourceUrl: string | null;
    urlId: number | null;
  };
  captureEvent: null | {
    id: string;
    createdAt: string;
    actorId: string | null;
    actorName: string | null;
    requestId: string | null;
    pipeline: {
      id: string;
      name: string;
      version: string;
      configHash: string;
      codeSha: string | null;
    };
  };
};

export async function getUrlRevisions(urlId: number, limit = 50) {
  return apiGet<{
    documentId: string | null;
    revisions: BackendDocumentRevision[];
  }>(`/api/urls/${urlId}/revisions?limit=${encodeURIComponent(String(limit))}`);
}

export async function getDocumentRevisions(documentId: string, limit = 50) {
  return apiGet<{
    document: {
      id: string;
      kind: "URL" | "FILE";
      urlId: number | null;
      primaryFileId: string | null;
    };
    revisions: BackendDocumentRevision[];
  }>(
    `/api/documents/${encodeURIComponent(documentId)}/revisions?limit=${encodeURIComponent(
      String(limit),
    )}`,
  );
}

export async function getFileRevisions(fileId: string, limit = 50) {
  return apiGet<{
    document: {
      id: string;
      kind: "URL" | "FILE";
      urlId: number | null;
      primaryFileId: string | null;
    };
    revisions: BackendDocumentRevision[];
  }>(
    `/api/files/${encodeURIComponent(fileId)}/revisions?limit=${encodeURIComponent(
      String(limit),
    )}`,
  );
}

export async function deleteUrlsBulk(ids: number[]): Promise<void> {
  await api.delete("/api/urls", { data: { ids } });
}

// ---------- Collections API ----------
export type BackendCollection = {
  id: string;
  name: string;
  description?: string | null;
  ownerId?: string | null;
  visibility?: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchCollections(): Promise<BackendCollection[]> {
  const res = await api.get("/api/collections");
  return res.data as BackendCollection[];
}

export async function createCollectionApi(body: {
  id?: string;
  name: string;
  description?: string;
  ownerId?: string;
  visibility?: string;
}): Promise<BackendCollection> {
  const res = await api.post("/api/collections", body);
  return res.data as BackendCollection;
}

export async function renameCollectionApi(
  id: string,
  name: string,
): Promise<BackendCollection> {
  const res = await api.patch(`/api/collections/${id}`, { name });
  return res.data as BackendCollection;
}

export async function deleteCollectionApi(id: string): Promise<void> {
  await api.delete(`/api/collections/${id}`);
}

export async function setCollectionsForUrlApi(body: {
  url: string;
  title?: string;
  snippet?: string;
  collectionIds: string[];
}): Promise<{ ok: true; url: string; collectionIds: string[] }> {
  const res = await api.put("/api/collections/assign", body);
  return res.data;
}

export async function fetchCollectionsUrlMap(): Promise<{
  map: Record<string, string[]>;
}> {
  const res = await api.get("/api/collections/url-map");
  return res.data as { map: Record<string, string[]> };
}

export async function fetchCollectionsUrlMapFor(
  urls: string[],
): Promise<{ map: Record<string, string[]> }> {
  const res = await api.post("/api/collections/url-map", { urls });
  return res.data as { map: Record<string, string[]> };
}

export type UrlTaggingSummary = {
  total: number;
  untagged: number;
  byStatus: Record<string, number>;
  inProgress: number;
  failed: number;
  failedSample: Array<{
    id: number;
    url: string;
    title: string | null;
    taggingError: string | null;
    updatedAt: string;
  }>;
};

export async function getUrlTaggingSummary(): Promise<UrlTaggingSummary> {
  const res = await api.get("/api/urls/tagging/summary");
  return res.data as UrlTaggingSummary;
}

export async function retryFailedUrlTagging(
  body: { ids?: number[]; limit?: number } = {},
) {
  const res = await api.post("/api/urls/tagging/retry-failed", body);
  return res.data as {
    scheduled: number;
    ids: number[];
    failures?: Array<{ id: number; error: string }>;
  };
}

export type SaveUrlsRequestRow = {
  url: string;
  title: string;
  snippet?: string;
};
export type SaveUrlsResponse = {
  added: number;
  skipped: number;
  skippedUrls?: string[];
  rows?: Array<{ id: number; url: string; isNew: boolean }>;
};

// ---------- Folders ----------
export type BackendFolder = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
  hasChildren?: boolean;
};

export async function listFolders(parentId?: string): Promise<BackendFolder[]> {
  const params: any = {};
  if (typeof parentId === "string") params.parentId = parentId;
  const res = await api.get("/api/folders", { params });
  return res.data;
}

export async function createFolder(
  name: string,
  parentId?: string,
): Promise<BackendFolder> {
  const res = await api.post("/api/folders", { name, parentId });
  return res.data;
}

export async function getFolder(id: string): Promise<BackendFolder> {
  const res = await api.get(`/api/folders/${id}`);
  return res.data;
}

export async function renameFolder(
  id: string,
  name: string,
): Promise<BackendFolder> {
  const res = await api.patch(`/api/folders/${id}`, { name });
  return res.data;
}

export async function deleteFolder(id: string): Promise<void> {
  await api.delete(`/api/folders/${id}`);
}

// Move a folder to another parent folder (or root when null).
export async function moveFolder(id: string, targetFolderId?: string | null) {
  const res = await api.post(`/api/folders/${id}/move`, {
    targetFolderId: targetFolderId ?? null,
  });
  return res.data as BackendFolder;
}

// ---------- Crawl / Capture ----------
export async function crawlSaveText(
  url: string,
  folderId?: string,
  fileName?: string,
  urlId?: number,
) {
  try {
    const res = await api.post("/api/crawl/text", {
      url,
      folderId,
      fileName,
      urlId,
    });

    return toFileItem(res.data as BackendStoredFile);
  } catch (err: any) {
    normalizeApiError(err, "Text capture failed");
  }
}

export async function crawlSavePdf(
  url: string,
  folderId?: string,
  fileName?: string,
  fullPage?: boolean,
  reader?: boolean,
  urlId?: number,
) {
  try {
    const res = await api.post("/api/crawl/pdf", {
      url,
      folderId,
      fileName,
      fullPage,
      reader,
      urlId,
    });

    return toFileItem(res.data as BackendStoredFile);
  } catch (err: any) {
    normalizeApiError(err, "PDF capture failed");
  }
}

// ---------- Favorites + File detail ----------
export async function toggleFileFavorite(
  fileId: string,
  isFavorited: boolean,
): Promise<FileItem> {
  const res = await api.patch(`/api/files/${fileId}`, { isFavorited });
  return res.data;
}

export async function getFileById(fileId: string): Promise<FileItem> {
  const res = await api.get(`/api/files/${fileId}`);
  const data = res.data as BackendStoredFile;
  return toFileItem(data);
}

export async function refreshFileMetadata(fileId: string): Promise<{
  id: string;
  sourcePublishedAt: string | null;
  sourceAuthors: string[];
}> {
  const res = await api.post(`/api/files/${fileId}/refresh-metadata`);
  return res.data;
}

export async function getFileExtractedText(fileId: string, maxChars = 200000) {
  const res = await api.get(`/api/files/${fileId}/extracted-text`, {
    params: { maxChars },
  });
  return res.data as {
    id: string;
    fileName: string;
    mimeType: string;
    captureType?: string | null;
    sourceUrl?: string | null;
    urlId?: number | null;
    sha256?: string | null;
    truncated: boolean;
    text: string;
  };
}

export async function moveFolderToTrash(id: string) {
  await api.patch(`/api/folders/${id}/trash`);
}
export async function moveFileToTrash(id: string) {
  await api.patch(`/api/files/${id}/trash`);
}
export async function restoreFolderFromTrash(id: string) {
  return api.patch(`/api/folders/${id}/restore`);
}
export async function restoreFileFromTrash(id: string) {
  return api.patch(`/api/files/${id}/restore`);
}
export async function deleteFolderPermanently(id: string) {
  return api.delete(`/api/folders/${id}`);
}
export async function deleteFilePermanently(id: string) {
  return api.delete(`/api/files/${id}`);
}

// ---------- File copy/move (per-file) ----------
export async function duplicateFile(
  fileId: string,
  folderId?: string | null,
  fileName?: string,
) {
  const res = await api.post(`/api/files/${fileId}/duplicate`, {
    folderId: folderId ?? null,
    fileName,
  });
  return toFileItem(res.data as BackendStoredFile);
}

export async function moveFile(fileId: string, folderId?: string | null) {
  const res = await api.post(`/api/files/${fileId}/move`, {
    folderId: folderId ?? null,
  });
  return toFileItem(res.data as BackendStoredFile);
}

// ---------- Optional: tiny bulk helpers ----------
export async function duplicateFiles(ids: string[], folderId?: string | null) {
  const created = await Promise.all(
    ids.map((id) => duplicateFile(id, folderId)),
  );
  return created;
}
export async function moveFiles(ids: string[], folderId?: string | null) {
  const moved = await Promise.all(ids.map((id) => moveFile(id, folderId)));
  return moved;
}

// ---------- Tags ----------
export async function fetchAllTags(): Promise<
  { label: string; count: number }[]
> {
  const res = await api.get("/api/tags");
  return res.data;
}

export type JobState =
  | { state: "PENDING" | "RETRY" }
  | { state: "STARTED"; progress?: number }
  | {
      state: "SUCCESS";
      tags: string[];
      phrases?: string[];
      unigrams?: string[];
      hash?: string;
      tagger_version?: string;
      structured?: any;
    }
  | { state: "FAILURE"; error?: string };
export type TagJobState =
  | "PENDING"
  | "STARTED"
  | "RETRY"
  | "SUCCESS"
  | "FAILURE";

export type TagJobSuccess = { state: "SUCCESS"; tags: string[] };
export type TagJobFailure = { state: "FAILURE"; error?: string };
export type TagJobPending = { state: "PENDING" | "STARTED" | "RETRY" };

export type TagJob = TagJobSuccess | TagJobFailure | TagJobPending;

export async function startFileTagJob(fileId: string) {
  const { data } = await api.post(
    `/api/files/${encodeURIComponent(fileId)}/auto-tags`,
  );
  return data as { jobId: string };
}

export async function startUrlTagJob(urlId: number) {
  const { data } = await api.post(
    `/api/urls/${encodeURIComponent(String(urlId))}/auto-tags`,
  );
  return data as { jobId: string };
}

export async function getJob(jobId: string, query: string) {
  const { data } = await api.get(
    `/api/tag-jobs/${encodeURIComponent(jobId)}?${query}`,
  );
  return data as JobState;
}

export async function getFileTagJob(jobId: string, fileId: string) {
  // Backend persists tags ONLY when fileId is present on /api/tag-jobs/:jobId
  const q = `fileId=${encodeURIComponent(fileId)}`;
  return getJob(jobId, q);
}

export async function getUrlTagJob(jobId: string, urlId: number) {
  // Same concept for URLs (used later / elsewhere)
  const q = `urlId=${encodeURIComponent(String(urlId))}`;
  return getJob(jobId, q);
}

api.interceptors.request.use((cfg) => {
  const rid = window.crypto?.randomUUID?.() ?? String(Date.now());
  cfg.headers = axios.AxiosHeaders.from({
    ...(cfg.headers || {}),
    "X-Request-ID": rid,
  });
  return cfg;
});

// ---------- Zip-as-folder ----------
export async function listZipChildren(fileId: string, prefix = "") {
  const res = await api.get(`/api/files/${fileId}/archive/list`, {
    params: { prefix },
  });
  return res.data as {
    prefix: string;
    folders: string[];
    files: { name: string; size: number; modified?: string }[];
  };
}
export function streamZipFile(fileId: string, p: string) {
  return apiUrl(
    `/api/files/${fileId}/archive/stream?path=${encodeURIComponent(p)}`,
  );
}
export async function searchZip(fileId: string, q: string) {
  const res = await api.get(`/api/files/${fileId}/archive/search`, {
    params: { q },
  });
  return res.data as { q: string; hits: string[] };
}
// ---------- Storage ----------
export async function getStorageUsage() {
  const res = await api.get("/api/storage/usage");
  return res.data as { usedBytes: number };
}

// ---------- File updates ----------
export async function renameFile(fileId: string, fileName: string) {
  const res = await api.put(`/api/files/${fileId}/rename`, { fileName });
  return res.data as { id: string; fileName: string };
}

export async function updateFileTags(fileId: string, tags: string[]) {
  const res = await api.patch(`/api/files/${fileId}`, { tags });
  return res.data;
}

// ---------- Trash (soft delete) ----------
export async function trashFile(id: string) {
  return api.patch(`/api/files/${id}/trash`);
}

export async function listTrashFiles(params?: Record<string, any>) {
  const res = await api.get("/api/trash", { params });
  return res.data;
}
export async function listTrash(params?: Record<string, any>) {
  return listTrashFiles(params);
}

// ---------- Generic files query (sorting/filtering/paging passthrough) ----------
export async function queryFiles(params: Record<string, any>) {
  const res = await api.get("/api/files", { params });
  return res.data;
}

export default api;
