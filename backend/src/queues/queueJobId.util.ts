export type IngestionQueueMode = "ingest" | "ocr";

function sanitizeBullMqJobIdPart(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function buildIngestionQueueJobId(
  sourceId: string,
  mode: IngestionQueueMode,
) {
  const safeSourceId = sanitizeBullMqJobIdPart(sourceId);

  return `${safeSourceId}__${mode}`;
}

export function buildAiTagUrlQueueJobId(urlId: number) {
  const safeUrlId = sanitizeBullMqJobIdPart(urlId);

  return `ai-tag-url__${safeUrlId}`;
}

export function buildAiTagFileQueueJobId(fileId: string) {
  const safeFileId = sanitizeBullMqJobIdPart(fileId);

  return `ai-tag-file__${safeFileId}`;
}
