type TagMetaLike = Record<string, any>;

export function normalizeTagList(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of arr) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);
  }

  return out;
}

export function mergeUniqueTags(...lists: Array<unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const value of normalizeTagList(list)) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }

  return out;
}

export function deriveSeparatedTags(currentTags: unknown, tagsMeta: unknown) {
  const meta =
    tagsMeta && typeof tagsMeta === "object" ? (tagsMeta as TagMetaLike) : {};

  const aiTags = normalizeTagList(
    meta?.tagger?.aiTags ?? meta?.aiTagger?.tags ?? [],
  );

  const hasExplicitUserTags = Array.isArray(meta?.userTags);

  let userTags = hasExplicitUserTags ? normalizeTagList(meta.userTags) : [];

  if (!hasExplicitUserTags) {
    const aiSet = new Set(aiTags.map((t) => t.toLowerCase()));
    userTags = normalizeTagList(currentTags).filter(
      (t) => !aiSet.has(t.toLowerCase()),
    );
  }

  const effectiveTags = mergeUniqueTags(userTags, aiTags);

  return { userTags, aiTags, effectiveTags };
}

export function withSeparatedTagsMeta(
  prev: unknown,
  args: {
    userTags: unknown;
    aiTags: unknown;
  },
) {
  const base = prev && typeof prev === "object" ? (prev as TagMetaLike) : {};
  const prevTagger =
    base.tagger && typeof base.tagger === "object" ? base.tagger : {};
  const prevAiTagger =
    base.aiTagger && typeof base.aiTagger === "object" ? base.aiTagger : {};

  const userTags = normalizeTagList(args.userTags);
  const aiTags = normalizeTagList(args.aiTags);

  return {
    ...base,
    userTags,
    tagger: {
      ...prevTagger,
      aiTags,
    },
    aiTagger: {
      ...prevAiTagger,
      tags: aiTags,
    },
  };
}
