// frontend/lib/notebookClient.ts

export type ID = string;
export type SourceKind = 'URL' | 'FILE';

export type Notebook = {
  id: ID;
  title: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NBSource = {
  id: ID;
  notebookId: ID;
  kind: SourceKind;
  url?: { id: ID; url: string; title?: string | null } | null;
  file?: { id: ID; fileName: string; mimeType?: string | null } | null;
  createdAt: string;
};

export type ChunkDetail = {
  id: ID;
  sourceId: ID;
  idx: number;
  text: string;
  source: NBSource;
};

export type ReaderChunk = {
  id: ID;
  idx: number;
  text: string;
};

export type ChunkReader = {
  sourceId: ID;
  source: NBSource;
  centerChunkId: ID;
  centerIdx: number;
  radius: number;
  totalChunks: number;
  chunks: ReaderChunk[];
};

export type NBNote = {
  id: ID;
  notebookId: ID;
  title?: string | null;
  content: string;
  citations?: any;
  createdAt: string;
  updatedAt: string;
};

export type ChatAnswer = {
  answer: string; // markdown
  citations: { chunkId: string }[];
  suggested: string[];
};

export interface NotebookClient {
  listNotebooks(): Promise<Notebook[]>;
  createNotebook(p: { title: string; description?: string }): Promise<Notebook>;
  getNotebook(id: ID): Promise<{ notebook: Notebook; sources: NBSource[]; notes: NBNote[] }>;
  updateNotebook(id: ID, p: { title?: string; description?: string }): Promise<Notebook>;

  listSources(notebookId: ID): Promise<NBSource[]>;
  addUrlSource(notebookId: ID, urlId: ID): Promise<NBSource>;
  addFileSource(notebookId: ID, fileId: ID): Promise<NBSource>;
  deleteSource(notebookId: ID, sourceId: ID): Promise<void>;

  chat(notebookId: ID, message: string): Promise<ChatAnswer>;
  getChunk(chunkId: ID): Promise<ChunkDetail>;
  getChunkReader(chunkId: ID, radius?: number): Promise<ChunkReader>;

  createNote(notebookId: ID, p: { title?: string; content: string; citations?: any }): Promise<NBNote>;
  updateNote(notebookId: ID, noteId: ID, p: { title?: string; content?: string; citations?: any }): Promise<NBNote>;

  // existing endpoints in your backend
  listAllUrls(): Promise<any[]>;
  listAllFiles(): Promise<any[]>;
}

const BASE = '/api';

async function j<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = '';
    try { msg = await res.text(); } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const notebookClient: NotebookClient = {
  // notebooks
  listNotebooks() {
    return j<Notebook[]>('GET', `/notebooks`);
  },
  createNotebook(p) {
    return j<Notebook>('POST', `/notebooks`, p);
  },
  getNotebook(id) {
    return j<{ notebook: Notebook; sources: NBSource[]; notes: NBNote[] }>('GET', `/notebooks/${id}`);
  },
  updateNotebook(id, p) {
    return j<Notebook>('PATCH', `/notebooks/${id}`, p);
  },

  // sources
  listSources(notebookId) {
    return j<NBSource[]>('GET', `/notebooks/${notebookId}/sources`);
  },
  addUrlSource(notebookId, urlId) {
    // backend accepts string or number; it casts internally
    return j<NBSource>('POST', `/notebooks/${notebookId}/sources/url`, { urlId });
  },
  addFileSource(notebookId, fileId) {
    return j<NBSource>('POST', `/notebooks/${notebookId}/sources/file`, { fileId });
  },
  async deleteSource(notebookId, sourceId) {
    await j<void>('DELETE', `/notebooks/${notebookId}/sources/${sourceId}`);
  },

  // chat
  chat(notebookId, message) {
    return j<ChatAnswer>('POST', `/notebooks/${notebookId}/chat`, { message });
  },
  getChunk(chunkId) {
    return j<ChunkDetail>('GET', `/chunks/${chunkId}`);
  },
  getChunkReader(chunkId, radius = 3) {
    return j<ChunkReader>('GET', `/chunks/${chunkId}/reader?radius=${encodeURIComponent(String(radius))}`);
  },

  // notes
  createNote(notebookId, p) {
    return j<NBNote>('POST', `/notebooks/${notebookId}/notes`, p);
  },
  updateNote(notebookId, noteId, p) {
    return j<NBNote>('PATCH', `/notebooks/${notebookId}/notes/${noteId}`, p);
  },

  // existing resources
  listAllUrls() {
    return j<any[]>('GET', `/urls`);
  },
  listAllFiles() {
    return j<any[]>('GET', `/files`);
  },
};
