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

export type NotebookAuditEvent = {
  id: ID;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status: "SUCCESS" | "FAILURE" | "INFO";
  actorId?: string | null;
  actorName?: string | null;
  requestId?: string | null;
  metadata?: any;
  createdAt: string;
};

export type JobRuntime = {
  status: "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  error?: string | null;
  updatedAt: string;
  attemptCount?: number;
  queueJobId?: string | null;
  stage?: string | null;
  progressPct?: number | null;
  statusMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastErrorAt?: string | null;
  meta?: any;
};

export type NBSource = {
  id: ID;
  notebookId: ID;
  kind: SourceKind;
  url?: { id: ID; url: string; title?: string | null } | null;
  file?: { id: ID; fileName: string; mimeType?: string | null } | null;
  ingestionJob?: JobRuntime | null;
  embeddingJob?: JobRuntime | null;
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

export type SourceDiagnostics = {
  source: {
    id: ID;
    notebookId: ID;
    kind: SourceKind;
    url?: { id: ID; url: string; title?: string | null } | null;
    file?: { id: ID; fileName: string; mimeType?: string | null } | null;
    createdAt: string;
  };
  jobs: {
    ingestion: JobRuntime | null;
    embedding: JobRuntime | null;
  };
  activeRevision: {
    id: ID;
    ordinal: number;
    contentHash?: string | null;
    createdAt: string;
    pipelineConfig?: {
      id: ID;
      name: string;
      version: string;
      configHash: string;
      codeSha?: string | null;
    } | null;
  } | null;
  counts: { pageCount: number; chunkCount: number; embeddedCount: number };
  textPreview: string;
  pagePreviews:
    | { pageNumber: number; charCount: number; preview: string }[]
    | null;
  recentAudit: NotebookAuditEvent[];
};

export type NBNote = {
  id: ID;
  notebookId: ID;
  title?: string | null;
  content: string;
  citations?: NoteProvenanceBundle | null;
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

  sourceRevisionId?: string | null;
  documentRevisionId?: string | null;
  pipelineConfigId?: string | null;
};

export type EvidenceBlock = {
  claim: string;
  citations: Citation[];
};

export type GroundingClaim = {
  claim: string;
  status: "supported" | "review_needed";
  supportScore: number;
  citedChunkIds: string[];
  reasons: string[];
};

export type GroundingReport = {
  version: "grounding-v1";
  status: "verified" | "partially_supported" | "unsupported";
  supportedClaimsCount: number;
  unsupportedClaimsCount: number;
  claims: GroundingClaim[];
};

export type ClaimCitationLink = {
  claim: string;
  status: "linked" | "review_needed";
  source: "evidence" | "derived";
  supportScore: number;
  citations: Citation[];
};

export type NoteProvenanceArtifact = {
  kind: "chat-answer" | "template-note";
  runId?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  answerMode?: AnswerMode | null;
  createdAt: string;
  latencyMs?: number | null;
  answer: string;
  citations: Citation[];
  evidence?: EvidenceBlock[];
  claimLinks?: ClaimCitationLink[];
  templateKey?: NotebookTemplateKey | null;
  templateLabel?: string | null;
  sourceContext?: {
    documentId?: string | null;
    issueId?: string | null;
    agencyId?: string | null;
    relationType?: string | null;
    issueTitle?: string | null;
    agencyName?: string | null;
    documentKind?: string | null;
  } | null;
};

export type NoteProvenanceBundle = {
  version: "note-provenance-v1";
  artifacts: NoteProvenanceArtifact[];
};

export type ChatAnswer = {
  mode: AnswerMode;
  answer: string;
  citations: Citation[];
  evidence?: EvidenceBlock[];
  suggested: string[];
  grounding?: GroundingReport | null;
  claimLinks?: ClaimCitationLink[];

  runId?: string;
  promptVersion?: string;
  model?: string | null;
  latencyMs?: number | null;
};

export type ChatHistoryRun = {
  id: ID;
  createdAt: string;
  status: "SUCCEEDED" | "FAILED";
  userMessage: string;
  answerMode: AnswerMode;
  answer: string | null;
  citations: Citation[];
  evidence?: EvidenceBlock[];
  suggested: string[];
  grounding?: GroundingReport | null;
  claimLinks?: ClaimCitationLink[];
  error?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  latencyMs?: number | null;
};

export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalBytes?: number;
};

export type NotebookTemplateKey =
  | "governance_brief"
  | "contradiction_brief"
  | "agency_comparison_summary"
  | "issue_landscape_summary"
  | "case_timeline_note"
  | "accountability_coordination_gap_note";

export type NotebookTemplateDefinition = {
  key: NotebookTemplateKey;
  label: string;
  badge: string;
  description: string;
  defaultTitlePrefix: string;
  required: {
    document: boolean;
    issue: boolean;
    agency: boolean;
  };
  sections: string[];
};

export type NotebookTemplateNoteResult = {
  note: NBNote;
  template: NotebookTemplateDefinition;
  context: {
    documentId?: string | null;
    issueId?: string | null;
    agencyId?: string | null;
    relationType?: string | null;
    issueTitle?: string | null;
    agencyName?: string | null;
    documentKind?: string | null;
  };
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

  getChatHistory(notebookId: ID, limit?: number): Promise<ChatHistoryRun[]>;

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

  // repair + diagnostics
  getSourceDiagnostics(
    notebookId: ID,
    sourceId: ID,
    maxChars?: number,
  ): Promise<SourceDiagnostics>;
  retrySourceIngestion(notebookId: ID, sourceId: ID): Promise<NBSource>;
  retrySourceEmbedding(notebookId: ID, sourceId: ID): Promise<NBSource>;
  rebuildSourceEmbedding(notebookId: ID, sourceId: ID): Promise<NBSource>;

  createNote(
    notebookId: ID,
    p: {
      title?: string;
      content: string;
      citations?: NoteProvenanceBundle | null;
    },
  ): Promise<NBNote>;
  updateNote(
    notebookId: ID,
    noteId: ID,
    p: {
      title?: string;
      content?: string;
      citations?: NoteProvenanceBundle | null;
    },
  ): Promise<NBNote>;
  deleteNote(notebookId: ID, noteId: ID): Promise<void>;

  listTemplates(): Promise<NotebookTemplateDefinition[]>;
  createTemplateNote(
    notebookId: ID,
    p: {
      templateKey: NotebookTemplateKey;
      documentId?: ID;
      issueId?: ID;
      agencyId?: ID;
      relationType?: string;
      titleOverride?: string;
    },
  ): Promise<NotebookTemplateNoteResult>;

  // (SourcePicker)
  listUrlPicker(p?: {
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PagedResult<any>>;
  listFilePicker(p?: {
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PagedResult<any>>;

  // legacy endpoints (raw arrays)
  listAllUrls(): Promise<any[]>;
  listAllFiles(): Promise<any[]>;
}

const BASE = "/api";

function toQuery(params: Record<string, any>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (!s) continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

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

  // repair + diagnostics
  getSourceDiagnostics(notebookId, sourceId, maxChars = 20000) {
    return j<SourceDiagnostics>(
      "GET",
      `/notebooks/${notebookId}/sources/${sourceId}/diagnostics?maxChars=${encodeURIComponent(
        String(maxChars),
      )}`,
    );
  },
  retrySourceIngestion(notebookId, sourceId) {
    return j<NBSource>(
      "POST",
      `/notebooks/${notebookId}/sources/${sourceId}/retry-ingestion`,
    );
  },
  retrySourceEmbedding(notebookId, sourceId) {
    return j<NBSource>(
      "POST",
      `/notebooks/${notebookId}/sources/${sourceId}/retry-embedding`,
    );
  },
  rebuildSourceEmbedding(notebookId, sourceId) {
    return j<NBSource>(
      "POST",
      `/notebooks/${notebookId}/sources/${sourceId}/rebuild-embedding`,
    );
  },

  getChatHistory(notebookId, limit = 50) {
    return j<ChatHistoryRun[]>(
      "GET",
      `/notebooks/${notebookId}/chat/history?limit=${encodeURIComponent(String(limit))}`,
    );
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

  listTemplates() {
    return j<NotebookTemplateDefinition[]>("GET", `/notebook-templates`);
  },

  createTemplateNote(notebookId, p) {
    return j<NotebookTemplateNoteResult>(
      "POST",
      `/notebooks/${notebookId}/template-notes`,
      p,
    );
  },

  // (SourcePicker)
  async listUrlPicker(p) {
    const q = toQuery({
      q: p?.q,
      page: p?.page ?? 1,
      pageSize: p?.pageSize ?? 50,
    });
    const data: any = await j<any>("GET", `/urls${q}`);
    if (Array.isArray(data)) {
      return {
        items: data,
        total: data.length,
        page: 1,
        pageSize: data.length,
      };
    }
    return data as PagedResult<any>;
  },
  async listFilePicker(p) {
    const q = toQuery({
      q: p?.q,
      page: p?.page ?? 1,
      pageSize: p?.pageSize ?? 50,
    });
    const data: any = await j<any>("GET", `/files${q}`);
    if (Array.isArray(data)) {
      return {
        items: data,
        total: data.length,
        page: 1,
        pageSize: data.length,
      };
    }
    return data as PagedResult<any>;
  },

  // legacy endpoints (raw arrays)
  listAllUrls() {
    return j<any[]>("GET", `/urls`);
  },
  listAllFiles() {
    return j<any[]>("GET", `/files`);
  },
};
