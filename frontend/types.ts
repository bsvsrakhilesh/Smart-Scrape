export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export type Page = 'url-collector' | 'saved-urls' | 'file-manager'|'notebook';

// FileItem and related types for the file manager
export interface FileUploader {
  id: string;
  name: string;
}

export type Visibility = 'public' | 'private';

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

export interface SavedUrl {
  id: string;
  url: string;
  title: string;
  description?: string;
  faviconUrl?: string;
  domain: string;
  tags: string[];
  notes?: string;
  isFavorited: boolean;
  collections: string[]; // collection IDs
  visibility: Visibility;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  lastVisitedAt?: string; // ISO
  visitCount: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: string;
  visibility: Visibility;
}
