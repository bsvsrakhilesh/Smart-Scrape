// src/utils/tags.ts
export type TagMeta = {
  tag: string;
  score?: number;
  source?: string;
  canonical?: string;
};

export function mergeTags(a?: string[] | null, b?: string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const arr of [a ?? [], b ?? []]) {
    for (const t of arr) {
      const k = (t ?? "").toString().trim().toLowerCase();
      if (!k) continue;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

export function mergeTagsMeta(a?: TagMeta[] | null, b?: TagMeta[] | null): TagMeta[] {
  const byKey = new Map<string, TagMeta>();
  const ingest = (arr?: TagMeta[] | null) => {
    for (const m of arr ?? []) {
      const k = (m.tag ?? "").toString().trim().toLowerCase();
      if (!k) continue;
      // Prefer the higher score when duplicates exist
      const prev = byKey.get(k);
      if (!prev || (m.score ?? 0) > (prev.score ?? 0)) byKey.set(k, { ...m, tag: k });
    }
  };
  ingest(a);
  ingest(b);
  return Array.from(byKey.values());
}
