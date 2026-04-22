export type SearchResultDocType =
  | "court_order"
  | "notification"
  | "report"
  | "news_article"
  | "parliamentary_material"
  | "affidavit_filing"
  | "guideline_circular"
  | "official_document"
  | "other";

export type SearchResultSourceType =
  | "court"
  | "government"
  | "parliament"
  | "news"
  | "research"
  | "other";

export type SearchResultConfidence = "high" | "medium" | "low";

export interface SearchResultRanking {
  rank: number;
  score: number;
  heuristicScore: number;
  llmScore: number;
  reasons: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  intelligence?: {
    docType: SearchResultDocType;
    sourceType: SearchResultSourceType;
    fileTypeHint: "pdf" | "html" | "doc" | "other";
    confidence: SearchResultConfidence;
    reason?: string;
  };
  ranking?: SearchResultRanking;
}

export type Page =
  | "url-collector"
  | "saved-urls"
  | "file-manager"
  | "governance-workspace"
  | "notebook";

// FileItem and related types for the file manager
export interface FileUploader {
  id: string;
  name: string;
}

export type Visibility = "public" | "private";

export type CaptureAccessMode = "public" | "institutional";

export type TaggingStatus =
  | "NONE"
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED";

export interface FileItem {
  id: string;
  title: string;
  description?: string;
  uploader: FileUploader;
  uploadDate: string; // ISO string
  size: number; // in bytes
  mimeType: string;
  thumbnailUrl?: string;
  tags: string[];
  userTags?: string[];
  aiTags?: string[];
  effectiveTags?: string[];
  downloads?: number;
  favoritesCount?: number;
  isFavorited?: boolean;
  visibility: Visibility;
  captureType?: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  sourceUrl?: string | null;
  urlId?: number | null;
  sourcePublishedAt?: string | null;
  sourceAuthors?: string[] | null;
  sha256?: string | null;
  captureMeta?: {
    method:
      | "direct_fetch"
      | "dom_candidate_fetch"
      | "puppeteer_intercept"
      | "page_print"
      | "institutional_node";
    capturedUrl?: string;
    contentType?: string | null;
    contentDisposition?: string | null;
    bytes?: number;
    notes?: string;
  } | null;
  contentHash?: string | null;
  taggerVersion?: string | null;
  taggingStatus?: TaggingStatus;
  taggingJobId?: string | null;
  taggingError?: string | null;
  aiTagJobProgress?: number | null;
  aiTagJobStage?: string | null;
  aiTagJobMessage?: string | null;
  aiTagJobAttempt?: number | null;
  aiTagJobCached?: boolean | null;
  tagsMetaRaw?: any;

  document?: {
    id: string;
    kind: "URL" | "FILE";
    urlId?: number | null;
    primaryFileId?: string | null;
  } | null;

  documentRevision?: {
    id: string;
    documentId: string;
    ordinal: number;
    createdAt: string;
    captureType: "UPLOAD" | "URL_TEXT" | "URL_PDF";
    contentHash?: string | null;
    storedFileId: string;
  } | null;

  captureEvent?: {
    id: string;
    createdAt: string;
    requestId?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    sourceUrl?: string | null;
    urlId?: number | null;
    pipelineConfig?: {
      id: string;
      name: string;
      version: string;
      configHash: string;
      codeSha?: string | null;
      createdAt: string;
    } | null;
  } | null;
}

export interface FileVersion {
  id: string;
  createdAt: string; // ISO
  note?: string;
  uploader: { id: string; name: string };
}

export interface FileDetail extends FileItem {
  fullText?: string; // optional if available for searching/highlighting
  versions?: FileVersion[];
  relatedFiles?: FileItem[]; // for "more like this"
  mimeSubtype?: string; // e.g., 'pdf', 'csv'
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string; // ISO
}

export interface SnapshotInfo {
  id: string;
  fileName: string;
  captureType: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  createdAt: string; // ISO
  sha256?: string | null;
}

export interface SavedUrl {
  id: string;
  url: string;
  title: string;
  description?: string;
  publishedAt?: string | null;
  authors?: string[];
  faviconUrl?: string;
  domain: string;
  tags: string[];
  userTags?: string[];
  aiTags?: string[];
  effectiveTags?: string[];
  tagsMetaRaw?: any;
  taggerVersion?: string | null;
  contentHash?: string | null;
  taggingStatus?: TaggingStatus;
  taggingError?: string | null;
  taggingJobId?: string | null;
  aiTagJobProgress?: number | null;
  aiTagJobStage?: string | null;
  aiTagJobMessage?: string | null;
  aiTagJobAttempt?: number | null;
  aiTagJobCached?: boolean | null;
  notes?: string;
  isFavorited: boolean;
  collections: string[]; // collection IDs
  visibility: Visibility;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  lastVisitedAt?: string; // ISO
  visitCount: number;
  latestSnapshot?: SnapshotInfo | null;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: string;
  visibility: Visibility;
  urlCount?: number;
}
