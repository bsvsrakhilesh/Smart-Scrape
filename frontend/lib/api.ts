import axios from 'axios';
import type { FileItem } from '../types';
const api = axios.create({
  // baseURL: '/api' // optional; Vite dev proxy handles /api to backend
});

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
};

export function toFileItem(row: BackendStoredFile): FileItem {
  return {
    id: row.id,
    title: row.fileName || 'Untitled',
    description: row.description || '',
    uploader: { id: row.uploaderId || 'unknown', name: row.uploaderName || 'Unknown' },
    uploadDate: row.createdAt,
    size: typeof row.size === 'number' ? row.size : 0,
    mimeType: row.mimeType,
    thumbnailUrl: '',
    tags: (row.tags as string[] | undefined) || [],
    downloads: row.downloads ?? 0,
    favoritesCount: row.favoritesCount ?? 0,
    isFavorited: row.isFavorited ?? false,
    visibility: (row.visibility as any) || 'private',
  };
}

// ---------- Saved URLs API (unchanged) ----------
export async function fetchSavedUrls(): Promise<BackendUrlRow[]> {
  const res = await api.get('/api/urls');
  return res.data;
}
export async function saveUrls(rows: { url: string; title: string; snippet?: string }[]) {
  const res = await api.post('/api/urls', {urls: rows});
  return res.data as { added: number; skipped: number };
}
export async function patchUrl(id: number, patch: any) {
  const res = await api.patch(`/api/urls/${id}`, patch);
  return res.data;
}
export async function deleteUrlsBulk(ids: number[]): Promise<void> {
  await api.delete('/api/urls', { data: { ids } });
}

export type SaveUrlsRequestRow = { url: string; title: string; snippet?: string };
export type SaveUrlsResponse = { added: number; skipped: number };

// ---------- Folders ----------
export type BackendFolder = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
};

export async function listFolders(parentId?: string): Promise<BackendFolder[]> {
  const params: any = {};
  if (typeof parentId === 'string') params.parentId = parentId;
  const res = await api.get('/api/folders', { params });
  return res.data;
}

export async function createFolder(name: string, parentId?: string): Promise<BackendFolder> {
  const res = await api.post('/api/folders', { name, parentId });
  return res.data;
}

export async function getFolder(id: string): Promise<BackendFolder> {
  const res = await api.get(`/api/folders/${id}`);
  return res.data;
}

export async function renameFolder(id: string, name: string): Promise<BackendFolder> {
  const res = await api.patch(`/api/folders/${id}`, { name });
  return res.data;
}

export async function deleteFolder(id: string): Promise<void> {
  await api.delete(`/api/folders/${id}`);
}

// ---------- Crawl / Capture ----------
export async function crawlSaveText(url: string, folderId?: string, fileName?: string): Promise<FileItem> {
  const res = await api.post('/api/crawl/text', { url, folderId, fileName });
  return toFileItem(res.data as BackendStoredFile);
}

export async function crawlSavePdf(url: string, folderId?: string, fileName?: string, fullPage: boolean = true, reader: boolean = true): Promise<FileItem> {
  const res = await api.post('/api/crawl/pdf', { url, folderId, fileName, fullPage, reader  });
  return toFileItem(res.data as BackendStoredFile);
}

// ---------- Favorites + File detail ----------
export async function toggleFileFavorite(fileId: string, isFavorited: boolean): Promise<FileItem> {
  const res = await api.patch(`/api/files/${fileId}`, { isFavorited });
  return res.data;
}

export async function getFileById(fileId: string): Promise<FileItem> {
  const res = await api.get(`/api/files/${fileId}`);
  const data = res.data as BackendStoredFile;
  return toFileItem(data);
}

export async function moveFolderToTrash(id: string) {
  await api.patch(`/api/folders/${id}/trash`);
}
export async function moveFileToTrash(id: string) {
  await api.patch(`/api/files/${id}/trash`);
}
export async function restoreFolder(id: string) {
  await api.patch(`/api/folders/${id}/restore`);
}
export async function restoreFile(id: string) {
  await api.patch(`/api/files/${id}/restore`);
}
export async function listTrash() {
  const res = await api.get('/api/trash');
  return res.data as {
    folders: { id: string; name: string; parentId?: string | null }[];
    files: BackendStoredFile[];
  };
}

// ---------- File copy/move (per-file) ----------
export async function duplicateFile(fileId: string, folderId?: string | null, fileName?: string) {
  const res = await api.post(`/api/files/${fileId}/duplicate`, { folderId: folderId ?? null, fileName });
  return toFileItem(res.data as BackendStoredFile);
}

export async function moveFile(fileId: string, folderId?: string | null) {
  const res = await api.post(`/api/files/${fileId}/move`, { folderId: folderId ?? null });
  return toFileItem(res.data as BackendStoredFile);
}

// ---------- Optional: tiny bulk helpers ----------
export async function duplicateFiles(ids: string[], folderId?: string | null) {
  const created = await Promise.all(ids.map(id => duplicateFile(id, folderId)));
  return created;
}
export async function moveFiles(ids: string[], folderId?: string | null) {
  const moved = await Promise.all(ids.map(id => moveFile(id, folderId)));
  return moved;
}

// ---------- Tags ----------
export async function fetchAllTags(): Promise<{ label: string; count: number }[]> {
  const res = await api.get('/api/tags');
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
    }
  | { state: "FAILURE"; error?: string };
export type TagJobState = 'PENDING' | 'STARTED' | 'RETRY' | 'SUCCESS' | 'FAILURE';

export type TagJobSuccess = { state: 'SUCCESS'; tags: string[] };
export type TagJobFailure = { state: 'FAILURE'; error?: string };
export type TagJobPending  = { state: 'PENDING' | 'STARTED' | 'RETRY' };

export type TagJob = TagJobSuccess | TagJobFailure | TagJobPending;

export async function startFileTagJob(fileId: string) {
  const { data } = await api.post(`/api/files/${encodeURIComponent(fileId)}/auto-tags`);
  return data as { jobId: string };
}

export async function startUrlTagJob(urlId: number) {
  const { data } = await api.post(`/api/urls/${encodeURIComponent(String(urlId))}/auto-tags`);
  return data as { jobId: string };
}

export async function getJob(jobId: string, query: string) {
  const { data } = await api.get(`/api/tag-jobs/${encodeURIComponent(jobId)}?${query}`);
  return data as JobState;
}

api.interceptors.request.use(cfg => {
  const rid = (window.crypto?.randomUUID?.() ?? String(Date.now()));
  cfg.headers = axios.AxiosHeaders.from({ ...(cfg.headers || {}), 'X-Request-ID': rid });
  return cfg;
});

// ---------- Zip-as-folder ----------
export async function listZipChildren(fileId: string, prefix = '') {
  const res = await api.get(`/api/files/${fileId}/archive/list`, { params: { prefix } });
  return res.data as { prefix: string; folders: string[]; files: { name: string; size: number; modified?: string }[] };
}
export function streamZipFile(fileId: string, p: string) {
  return `/api/files/${fileId}/archive/stream?path=${encodeURIComponent(p)}`;
}
export async function searchZip(fileId: string, q: string) {
  const res = await api.get(`/api/files/${fileId}/archive/search`, { params: { q } });
  return res.data as { q: string; hits: string[] };
}

// ---------- Trash (soft delete) ----------
export async function trashFile(id: string) {
  return api.patch(`/api/files/${id}/trash`);
}

// ---------- Folder move ----------
export async function moveFolder(folderId: string, targetFolderId: string | null) {
  return api.post(`/api/folders/${folderId}/move`, { targetFolderId });
}

// ---------- Generic files query (sorting/filtering/paging passthrough) ----------
export async function queryFiles(params: Record<string, any>) {
  const res = await api.get('/api/files', { params });
  return res.data;
}

export default api;