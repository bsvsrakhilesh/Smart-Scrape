// frontend/lib/notebookClient.ts

export type ID = string;
export type SourceKind = "URL" | "FILE";

export type Notebook = {
  id: ID;
  title: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnswerMode = "draft" | "evidence" | "briefing";

export type NBSource = {
  id: ID;
  notebookId: ID;
  kind: SourceKind;
  url?: { id: ID; url: string; title?: string | null } | null;
  file?: { id: ID; fileName: string; mimeType?: string | null } | null;

  ingestionJob?: {
    status: "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
    error?: string | null;
    updatedAt: string;
  } | null;

  embeddingJob?: {
    status: "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
    error?: string | null;
    updatedAt: string;
  } | null;

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

export type SourcePage = {
  sourceId: ID;
  pageNumber: number;
  text: string;
  globalStart: number;
  globalEnd: number;
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

export type Citation = {
  chunkId: string;
  quote: string;

  pageStart?: number | null;
  pageEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;

  sourceId?: string | null;
  sourceKind?: SourceKind | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  fileName?: string | null;
};

export type EvidenceBlock = {
  claim: string;
  citations: Citation[];
};

export type ChatAnswer = {
  mode: AnswerMode;
  answer: string;
  citations: Citation[];
  evidence?: EvidenceBlock[];
  suggested: string[];
};

export interface NotebookClient {
  listNotebooks(): Promise<Notebook[]>;
  createNotebook(p: { title: string; description?: string }): Promise<Notebook>;
  getNotebook(
    id: ID,
  ): Promise<{ notebook: Notebook; sources: NBSource[]; notes: NBNote[] }>;
  updateNotebook(
    id: ID,
    p: { title?: string; description?: string },
  ): Promise<Notebook>;
  deleteNotebook(id: ID): Promise<void>;

  listSources(notebookId: ID): Promise<NBSource[]>;
  addUrlSource(notebookId: ID, urlId: ID): Promise<NBSource>;
  addFileSource(notebookId: ID, fileId: ID): Promise<NBSource>;
  deleteSource(notebookId: ID, sourceId: ID): Promise<void>;

  chat(
    notebookId: ID,
    message: string,
    opts?: {
      sourceIds?: ID[];
      history?: { role: "user" | "assistant"; content: string }[];
      answerMode?: AnswerMode;
    },
  ): Promise<ChatAnswer>;
  getChunk(chunkId: ID): Promise<ChunkDetail>;
  getChunkReader(chunkId: ID, radius?: number): Promise<ChunkReader>;
  getSourcePage(sourceId: ID, pageNumber: number): Promise<SourcePage>;

  createNote(
    notebookId: ID,
    p: { title?: string; content: string; citations?: any },
  ): Promise<NBNote>;
  updateNote(
    notebookId: ID,
    noteId: ID,
    p: { title?: string; content?: string; citations?: any },
  ): Promise<NBNote>;
  deleteNote(notebookId: ID, noteId: ID): Promise<void>;

  // existing endpoints in your backend
  listAllUrls(): Promise<any[]>;
  listAllFiles(): Promise<any[]>;
}

const BASE = "/api";

async function j<T = any>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw || `HTTP ${res.status}`;

    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        const m = (parsed as any).message;
        if (typeof m === "string" && m.trim()) message = m;
      }
    } catch {
      // ignore JSON parse errors
    }

    throw new Error(message);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const notebookClient: NotebookClient = {
  // notebooks
  listNotebooks() {
    return j<Notebook[]>("GET", `/notebooks`);
  },
  createNotebook(p) {
    return j<Notebook>("POST", `/notebooks`, p);
  },
  getNotebook(id) {
    return j<{ notebook: Notebook; sources: NBSource[]; notes: NBNote[] }>(
      "GET",
      `/notebooks/${id}`,
    );
  },
  updateNotebook(id, p) {
    return j<Notebook>("PATCH", `/notebooks/${id}`, p);
  },
  async deleteNotebook(id) {
    await j<void>("DELETE", `/notebooks/${id}`);
  },

  // sources
  listSources(notebookId) {
    return j<NBSource[]>("GET", `/notebooks/${notebookId}/sources`);
  },
  addUrlSource(notebookId, urlId) {
    // backend accepts string or number; it casts internally
    return j<NBSource>("POST", `/notebooks/${notebookId}/sources/url`, {
      urlId,
    });
  },
  addFileSource(notebookId, fileId) {
    return j<NBSource>("POST", `/notebooks/${notebookId}/sources/file`, {
      fileId,
    });
  },
  async deleteSource(notebookId, sourceId) {
    await j<void>("DELETE", `/notebooks/${notebookId}/sources/${sourceId}`);
  },

  // chat
  chat(notebookId, message, opts) {
    return j<ChatAnswer>("POST", `/notebooks/${notebookId}/chat`, {
      message,
      sourceIds: opts?.sourceIds,
      history: opts?.history,
      answerMode: opts?.answerMode,
    });
  },
  // chunks
  getChunk(chunkId) {
    return j<ChunkDetail>("GET", `/chunks/${chunkId}`);
  },
  getChunkReader(chunkId, radius = 3) {
    return j<ChunkReader>(
      "GET",
      `/chunks/${chunkId}/reader?radius=${encodeURIComponent(String(radius))}`,
    );
  },
  getSourcePage(sourceId, pageNumber) {
    return j<SourcePage>("GET", `/sources/${sourceId}/pages/${pageNumber}`);
  },

  // notes
  createNote(notebookId, p) {
    return j<NBNote>("POST", `/notebooks/${notebookId}/notes`, p);
  },
  updateNote(notebookId, noteId, p) {
    return j<NBNote>("PATCH", `/notebooks/${notebookId}/notes/${noteId}`, p);
  },
  deleteNote(notebookId, noteId) {
    return j<void>("DELETE", `/notebooks/${notebookId}/notes/${noteId}`);
  },

  // existing resources
  listAllUrls() {
    return j<any[]>("GET", `/urls`);
  },
  listAllFiles() {
    return j<any[]>("GET", `/files`);
  },
};
