import path from "path";

export type FileValidationMode = "magic" | "text-sniff" | "extension";

export type FileCapability = {
  ext: string;
  canonicalMime: string;
  uploadAllowed: boolean;
  aiTagSupported: boolean;
  validation: FileValidationMode;
  aiUnsupportedReason?: string;
};

const EXT_CAPABILITIES: Record<string, Omit<FileCapability, "ext">> = {
  ".pdf": {
    canonicalMime: "application/pdf",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".docx": {
    canonicalMime:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "extension",
  },
  ".html": {
    canonicalMime: "text/html",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".htm": {
    canonicalMime: "text/html",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".txt": {
    canonicalMime: "text/plain",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".md": {
    canonicalMime: "text/markdown",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".csv": {
    canonicalMime: "text/csv",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".json": {
    canonicalMime: "application/json",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },
  ".xml": {
    canonicalMime: "application/xml",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "text-sniff",
  },

  ".png": {
    canonicalMime: "image/png",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".jpg": {
    canonicalMime: "image/jpeg",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".jpeg": {
    canonicalMime: "image/jpeg",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".webp": {
    canonicalMime: "image/webp",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".gif": {
    canonicalMime: "image/gif",
    uploadAllowed: true,
    aiTagSupported: true,
    validation: "magic",
  },
  ".svg": {
    canonicalMime: "image/svg+xml",
    uploadAllowed: true,
    aiTagSupported: false,
    validation: "text-sniff",
    aiUnsupportedReason:
      "AI tagging is not yet enabled for uploaded SVG files. Visual parsing/OCR will be added in the next step.",
  },
};

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "text/html": ".html",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

function normalizeMime(mime: string | undefined): string {
  return String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

export function inferCanonicalMime(
  fileName: string,
  fallback = "application/octet-stream",
): string {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext && EXT_CAPABILITIES[ext]) {
    return EXT_CAPABILITIES[ext].canonicalMime;
  }

  const normalizedFallback = normalizeMime(fallback);
  if (normalizedFallback && normalizedFallback !== "application/octet-stream") {
    const mappedExt = MIME_TO_EXT[normalizedFallback];
    if (mappedExt && EXT_CAPABILITIES[mappedExt]) {
      return EXT_CAPABILITIES[mappedExt].canonicalMime;
    }
    return normalizedFallback;
  }

  return "application/octet-stream";
}

export function getFileCapability(
  fileName: string,
  mimeType?: string,
): FileCapability {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext && EXT_CAPABILITIES[ext]) {
    return { ext, ...EXT_CAPABILITIES[ext] };
  }

  const normalizedMime = normalizeMime(mimeType);
  const mappedExt = MIME_TO_EXT[normalizedMime];
  if (mappedExt && EXT_CAPABILITIES[mappedExt]) {
    return { ext: mappedExt, ...EXT_CAPABILITIES[mappedExt] };
  }

  return {
    ext,
    canonicalMime: inferCanonicalMime(fileName, mimeType),
    uploadAllowed: false,
    aiTagSupported: false,
    validation: "extension",
    aiUnsupportedReason:
      "This file type is not yet supported by the upload and AI tagging pipeline.",
  };
}

export function getAiTaggingUnavailableMessage(
  fileName: string,
  mimeType?: string,
): string {
  const cap = getFileCapability(fileName, mimeType);
  if (cap.aiTagSupported) return "";
  return (
    cap.aiUnsupportedReason ||
    `AI tagging is not yet supported for ${cap.canonicalMime || "this file type"}.`
  );
}
