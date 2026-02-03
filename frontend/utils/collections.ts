import { Collection } from '../lib/types';
import { canonicalize } from './saved';

const COLLECTIONS_KEY = 'collections';
const URL_COLLECTIONS_KEY = 'urlCollectionsByUrl';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function genId(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

export function getCollections(): Collection[] {
  const cols = readJSON<Collection[]>(COLLECTIONS_KEY, []);
  if (cols.length === 0) {
    const def: Collection = {
      id: 'c_general',
      name: 'General',
      ownerId: 'local',
      createdAt: new Date().toISOString(),
      visibility: 'private',
    };
    writeJSON(COLLECTIONS_KEY, [def]);
    return [def];
  }
  return cols;
}

export function createCollection(name: string): Collection {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Name required');
  const cols = getCollections();
  const c: Collection = {
    id: genId(),
    name: trimmed,
    ownerId: 'local',
    createdAt: new Date().toISOString(),
    visibility: 'private',
  };
  writeJSON(COLLECTIONS_KEY, [...cols, c]);
  return c;
}

export function renameCollection(id: string, name: string) {
  const cols = getCollections().map(c => c.id === id ? { ...c, name: name.trim() } : c);
  writeJSON(COLLECTIONS_KEY, cols);
}

export function deleteCollection(id: string) {
  const cols = getCollections().filter(c => c.id != id);
  writeJSON(COLLECTIONS_KEY, cols);
  // remove from URL mapping
  const map = readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
  const next: Record<string, string[]> = {};
  Object.entries(map).forEach(([u, arr]) => {
    const filtered = (arr || []).filter(cid => cid !== id);
    if (filtered.length) next[u] = filtered;
  });
  writeJSON(URL_COLLECTIONS_KEY, next);
}

export function getUrlCollections(rawUrl: string): string[] {
  const u = canonicalize(rawUrl);
  const map = readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
  return map[u] || [];
}

export function addUrlToCollection(collectionId: string, rawUrl: string) {
  if (!collectionId) return;
  const u = canonicalize(rawUrl);
  const map = readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
  const set = new Set(map[u] || []);
  set.add(collectionId);
  map[u] = Array.from(set);
  writeJSON(URL_COLLECTIONS_KEY, map);
}

export function setUrlCollections(rawUrl: string, collectionIds: string[]) {
  const u = canonicalize(rawUrl);
  const map = readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
  map[u] = Array.from(new Set(collectionIds.filter(Boolean)));
  writeJSON(URL_COLLECTIONS_KEY, map);
}

export function removeUrlFromCollection(collectionId: string, rawUrl: string) {
  const u = canonicalize(rawUrl);
  const map = readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
  const s = new Set(map[u] || []);
  s.delete(collectionId);
  if (s.size) {
    map[u] = Array.from(s);
  } else {
    delete map[u];
  }
  writeJSON(URL_COLLECTIONS_KEY, map);
}
