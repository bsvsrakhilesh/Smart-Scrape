import { SearchResult } from '../lib/types';
import { canonicalizeUrl } from './urlCanonical';

export const SAVED_KEY = 'savedUrls';

export function canonicalize(raw: string): string {
  return canonicalizeUrl(raw);
}

function normalizeSavedRows(rows: unknown[]): SearchResult[] {
  const seen = new Set<string>();
  const normalized: SearchResult[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const rawUrl =
      typeof (row as { url?: unknown }).url === 'string'
        ? (row as { url: string }).url
        : '';
    const canonicalUrl = canonicalize(rawUrl);
    if (!canonicalUrl || seen.has(canonicalUrl)) continue;

    seen.add(canonicalUrl);
    normalized.push({
      title:
        typeof (row as { title?: unknown }).title === 'string'
          ? (row as { title: string }).title
          : '',
      url: canonicalUrl,
      snippet:
        typeof (row as { snippet?: unknown }).snippet === 'string'
          ? (row as { snippet: string }).snippet
          : '',
    });
  }

  return normalized;
}

export function getSaved(): SearchResult[] {
  const raw = localStorage.getItem(SAVED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return normalizeSavedRows(arr);
  } catch {
    console.error('[saved] parse error');
    return [];
  }
}

export function setSaved(list: SearchResult[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(normalizeSavedRows(list)));
}

export function addMany(rows: SearchResult[]): { added: number; skipped: number } {
  const existing = getSaved();
  const seen = new Set(existing.map((r) => canonicalize(r.url)));
  const merged = [...existing];
  let added = 0;
  let skipped = 0;

  for (const r of rows) {
    const c = canonicalize(r.url);
    if (seen.has(c)) {
      skipped++;
      continue;
    }
    seen.add(c);
    merged.push({ ...r, url: c });
    added++;
  }

  setSaved(merged);
  return { added, skipped };
}

export function removeSaved(rawUrl: string): boolean {
  const target = canonicalize(rawUrl);
  const existing = getSaved();

  const next = existing.filter((r) => canonicalize(r.url) !== target);
  if (next.length === existing.length) return false;

  setSaved(next);
  return true;
}
