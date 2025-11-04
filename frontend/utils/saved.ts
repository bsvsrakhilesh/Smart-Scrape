import { SearchResult } from '../types';

export const SAVED_KEY = 'savedUrls';

export function canonicalize(raw: string): string {
  try {
    const u = new URL(raw);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid']
      .forEach(p => u.searchParams.delete(p));
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

export function getSaved(): SearchResult[] {
  const raw = localStorage.getItem(SAVED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x: any) => x && typeof x.url === 'string')
      .map((x: any) => ({
        title: typeof x.title === 'string' ? x.title : '',
        url: x.url,
        snippet: typeof x.snippet === 'string' ? x.snippet : ''
      }));
  } catch {
    console.error('[saved] parse error');
    return [];
  }
}

export function setSaved(list: SearchResult[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export function addMany(rows: SearchResult[]): { added: number; skipped: number } {
  const existing = getSaved();
  const seen = new Set(existing.map(r => canonicalize(r.url)));
  const merged = [...existing];
  let added = 0, skipped = 0;

  for (const r of rows) {
    const c = canonicalize(r.url);
    if (seen.has(c)) { skipped++; continue; }
    seen.add(c);
    merged.push({ ...r, url: c });
    added++;
  }

  setSaved(merged);
  return { added, skipped };
}
