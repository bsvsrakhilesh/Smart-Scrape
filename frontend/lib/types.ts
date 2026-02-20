export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export type Page = "url-collector" | "saved-urls" | "file-manager" | "notebook";

// FileItem and related types for the file manager
export interface FileUploader {
  id: string;
  name: string;
}

export type Visibility = "public" | "private";

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
  downloads?: number;
  favoritesCount?: number;
  isFavorited?: boolean;
  visibility: Visibility;
  captureType?: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  sourceUrl?: string | null;
  urlId?: number | null;
  sha256?: string | null;
  captureMeta?: {
    method:
      | "direct_fetch"
      | "dom_candidate_fetch"
      | "puppeteer_intercept"
      | "page_print";
    capturedUrl?: string;
    contentType?: string | null;
    contentDisposition?: string | null;
    bytes?: number;
    notes?: string;
  } | null;
  contentHash?: string | null;
  taggerVersion?: string | null;
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
  faviconUrl?: string;
  domain: string;
  tags: string[];
  taggingStatus?: TaggingStatus;
  taggingError?: string | null;
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
}
