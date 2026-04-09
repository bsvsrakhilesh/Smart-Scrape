import { Collection } from "../lib/types";
import { canonicalize } from "./saved";
import {
  createCollectionApi,
  deleteCollectionApi,
  fetchCollections,
  fetchCollectionsUrlMap,
  renameCollectionApi,
  setCollectionsForUrlApi,
} from "../lib/api";

// These localStorage keys stay the same so existing UI code keeps working.
const COLLECTIONS_KEY = "collections";
const URL_COLLECTIONS_KEY = "urlCollectionsByUrl";

// Debounced refresh to keep backend as source-of-truth without spamming requests
let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHydrate(delayMs = 350) {
  if (hydrateTimer) clearTimeout(hydrateTimer);
  hydrateTimer = setTimeout(() => {
    hydrateCollectionsFromBackend().catch(() => {});
  }, delayMs);
}

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
  return "c_" + Math.random().toString(36).slice(2, 10);
}

function ensureDefaultLocalCollection() {
  const cols = readJSON<Collection[]>(COLLECTIONS_KEY, []);
  if (cols.length > 0) return;

  const def: Collection = {
    id: "c_general",
    name: "General",
    ownerId: "local",
    createdAt: new Date().toISOString(),
    visibility: "private",
  };

  writeJSON(COLLECTIONS_KEY, [def]);
}

function writeCollections(cols: Collection[]) {
  writeJSON(COLLECTIONS_KEY, cols);
}

function readUrlCollectionsMap(): Record<string, string[]> {
  return readJSON<Record<string, string[]>>(URL_COLLECTIONS_KEY, {});
}

function writeUrlCollectionsMap(map: Record<string, string[]>) {
  writeJSON(URL_COLLECTIONS_KEY, map);
}

function writeUrlCollections(rawUrl: string, collectionIds: string[]) {
  const u = canonicalize(rawUrl);
  const map = readUrlCollectionsMap();

  if (collectionIds.length === 0) {
    delete map[u];
  } else {
    map[u] = Array.from(new Set(collectionIds.filter(Boolean)));
  }

  writeUrlCollectionsMap(map);
}

function removeCollectionFromUrlMap(collectionId: string) {
  const map = readUrlCollectionsMap();
  const next: Record<string, string[]> = {};

  Object.entries(map).forEach(([u, arr]) => {
    const filtered = (arr || []).filter((cid) => cid !== collectionId);
    if (filtered.length) next[u] = filtered;
  });

  writeUrlCollectionsMap(next);
}

/**
 * Backend-backed hydration:
 * - Fetch collections + url-map from backend
 * - Write them into the same localStorage keys used by the UI
 *
 * Call once on app start and before pages that rely on fresh collection state.
 */
export async function hydrateCollectionsFromBackend(): Promise<void> {
  ensureDefaultLocalCollection();

  try {
    const [cols, mapRes] = await Promise.all([
      fetchCollections(),
      fetchCollectionsUrlMap(),
    ]);

    // If backend has no collections yet, seed with the local default (stable id)
    if (cols.length === 0) {
      const local = readJSON<Collection[]>(COLLECTIONS_KEY, []);
      const def = local.find((c) => c.id === "c_general") || local[0];

      if (def) {
        await createCollectionApi({
          id: def.id,
          name: def.name,
          visibility: def.visibility,
        });
      }

      const nextCols = await fetchCollections();
      writeCollections(nextCols as any);
    } else {
      writeCollections(cols as any);
    }

    writeUrlCollectionsMap(mapRes.map);
  } catch (e) {
    // Offline / backend unavailable: keep local cache
    console.warn("[collections] backend hydrate failed; using local cache", e);
  }
}

/** Read-only, synchronous cached view for UI rendering. */
export function getCollections(): Collection[] {
  ensureDefaultLocalCollection();
  return readJSON<Collection[]>(COLLECTIONS_KEY, []);
}

export function getUrlCollections(rawUrl: string): string[] {
  const u = canonicalize(rawUrl);
  const map = readUrlCollectionsMap();
  return map[u] || [];
}

/**
 * Backend-first create. Cache updates only after backend success.
 */
export async function createCollection(name: string): Promise<Collection> {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Name required");

  const created = await createCollectionApi({
    id: genId(),
    name: trimmed,
    visibility: "private",
  });

  const cols = getCollections().filter((c) => c.id !== created.id);
  writeCollections([...cols, created as any]);
  scheduleHydrate();

  return created as any;
}

export async function renameCollection(
  id: string,
  name: string,
): Promise<Collection> {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Name required");

  const updated = await renameCollectionApi(id, trimmed);

  const cols = getCollections().map((c) =>
    c.id === id ? ({ ...c, name: updated.name } as Collection) : c,
  );
  writeCollections(cols);
  scheduleHydrate();

  return updated as any;
}

export async function deleteCollection(id: string): Promise<void> {
  await deleteCollectionApi(id);

  const cols = getCollections().filter((c) => c.id !== id);
  writeCollections(cols);
  removeCollectionFromUrlMap(id);
  scheduleHydrate();
}

export async function setUrlCollections(
  rawUrl: string,
  collectionIds: string[],
  options?: { title?: string; snippet?: string | null },
): Promise<string[]> {
  const uniqueIds = Array.from(new Set(collectionIds.filter(Boolean)));

  await setCollectionsForUrlApi({
    url: rawUrl,
    title: options?.title,
    snippet: options?.snippet ?? undefined,
    collectionIds: uniqueIds,
  });

  writeUrlCollections(rawUrl, uniqueIds);
  scheduleHydrate();

  return uniqueIds;
}

export async function addUrlToCollection(
  collectionId: string,
  rawUrl: string,
  options?: { title?: string; snippet?: string | null },
): Promise<string[]> {
  if (!collectionId) return getUrlCollections(rawUrl);

  const existing = new Set(getUrlCollections(rawUrl));
  existing.add(collectionId);

  return setUrlCollections(rawUrl, Array.from(existing), options);
}

export async function removeUrlFromCollection(
  collectionId: string,
  rawUrl: string,
): Promise<string[]> {
  const existing = new Set(getUrlCollections(rawUrl));
  existing.delete(collectionId);

  return setUrlCollections(rawUrl, Array.from(existing));
}

/**
 * When a URL is removed from Saved URLs, scrub only the local collection cache.
 * Do NOT call the backend assign route here, because that route upserts the URL.
 */
export function reconcileUrlCollections(rawUrl: string): boolean {
  const u = canonicalize(rawUrl);
  const map = readUrlCollectionsMap();

  if (!(u in map)) return false;

  delete map[u];
  writeUrlCollectionsMap(map);
  return true;
}
