export type IngestionQueueMode = "ingest" | "ocr";

export function buildIngestionQueueJobId(
  sourceId: string,
  mode: IngestionQueueMode,
) {
  const safeSourceId = String(sourceId ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");

  return `${safeSourceId}__${mode}`;
}
