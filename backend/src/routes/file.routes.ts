import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import prisma from "../config/database";
import {
  ensureDocumentRevisionForStoredFile,
  listDocumentRevisions,
} from "../services/document.service";
import { recordCaptureEvent } from "../services/provenance.service";
import yazl from "yazl";
import crypto from "crypto";
import unzipper from "unzipper";
import pdfParse from "pdf-parse";
import { extractUrlMetadata } from "../services/extract.service";
import {
  getAiTaggingUnavailableMessage,
  getFileCapability,
  inferCanonicalMime,
} from "../utils/fileCapabilities";

// ===== Upload hardening =====
const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024, // 50MB default
);

const CHUNK_UPLOAD_TTL_MS = Number(
  process.env.CHUNK_UPLOAD_TTL_MS || 24 * 60 * 60 * 1000, // 24h default
);

// Fingerprint hardening:
// Frontend uses SHA-1 hex (40 chars) of "name-size-lastModified".
const FINGERPRINT_RE = /^[a-f0-9]{40}$/i;

function normalizeFingerprint(fp: unknown): string {
  const s = String(fp || "").trim();
  if (!FINGERPRINT_RE.test(s)) {
    throw new Error("INVALID_FINGERPRINT");
  }
  return s.toLowerCase();
}

// Ensures the resolved path always stays inside baseDir (blocks ../../ traversal).
function safeResolveUnder(baseDir: string, ...parts: string[]): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, ...parts);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("PATH_TRAVERSAL");
  }
  return resolved;
}

function sanitizeFilename(name: string): string {
  return String(name || "file")
    .replace(/[\/\\]/g, "_") // block path traversal
    .replace(/\0/g, "") // remove NULL bytes
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function isDangerousMimetype(mime: string | undefined): boolean {
  const m = String(mime || "").toLowerCase();
  // basic denylist (tune later)
  return (
    m.includes("x-msdownload") || // exe
    m.includes("x-dosexec") ||
    m.includes("x-sh") || // shell script
    m.includes("x-bat") ||
    m.includes("x-powershell") ||
    m.includes("application/x-executable")
  );
}

function parsePdfDate(raw: unknown): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // pdf-parse often gives "D:YYYYMMDDHHmmSSOHH'mm'" formats
  // Examples: "D:20220101123000Z", "D:20220101123000+05'30'"
  const m = s.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|([+\-])(\d{2})'?(\d{2})'?)?/,
  );
  if (m) {
    const year = Number(m[1]);
    const mon = Number(m[2] || "01");
    const day = Number(m[3] || "01");
    const hh = Number(m[4] || "00");
    const mm = Number(m[5] || "00");
    const ss = Number(m[6] || "00");

    // Build as UTC first
    let dt = new Date(Date.UTC(year, mon - 1, day, hh, mm, ss));

    // Apply offset if present
    const z = m[7];
    if (z && z !== "Z") {
      const sign = m[8] === "-" ? -1 : 1;
      const oh = Number(m[9] || "00");
      const om = Number(m[10] || "00");
      const offsetMin = sign * (oh * 60 + om);
      dt = new Date(dt.getTime() - offsetMin * 60_000);
    }
    return dt;
  }

  // Fall back to Date parsing (handles ISO-like strings)
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function uniqAuthors(input: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of input) {
    const t = String(a || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

async function extractPdfFileMetadata(filePath: string): Promise<{
  sourcePublishedAt: Date | null;
  sourceAuthors: string[];
}> {
  try {
    const buf = fs.readFileSync(filePath);
    const parsed: any = await pdfParse(buf);

    // pdf-parse returns { info, metadata, ... } but shape varies
    const info = parsed?.info || {};
    const meta = parsed?.metadata || {};

    const author =
      info?.Author || info?.author || meta?.Author || meta?.author || null;

    const creation =
      info?.CreationDate ||
      info?.creationDate ||
      meta?.CreationDate ||
      meta?.creationDate ||
      null;

    const mod =
      info?.ModDate || info?.modDate || meta?.ModDate || meta?.modDate || null;

    const sourcePublishedAt = parsePdfDate(creation) || parsePdfDate(mod);

    const sourceAuthors = uniqAuthors(author ? [String(author)] : []);

    return { sourcePublishedAt, sourceAuthors };
  } catch {
    return { sourcePublishedAt: null, sourceAuthors: [] };
  }
}

const r = Router();

const STORAGE_DIR =
  process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "storage");

// NOTE: chunk uploads must use memoryStorage so req.file.buffer exists.
// We validate the final stitched file type later (after stitching).
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  // per-chunk cap; your frontend chunk size is 1MB, so 2MB is safe headroom
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Stream a file with Range + HEAD + cache validators.
// Usage: await streamFileWithRange({ req, res, filePath, fileName, contentType, disposition: 'inline'|'attachment' });
async function streamFileWithRange(opts: {
  req: import("express").Request;
  res: import("express").Response;
  filePath: string;
  fileName: string;
  contentType: string;
  disposition?: "inline" | "attachment";
}) {
  const {
    req,
    res,
    filePath,
    fileName,
    contentType,
    disposition = "inline",
  } = opts;

  // Stat for size & times
  const stat = fs.statSync(filePath);
  const size = stat.size;

  // Cache validators & capability hints
  const etag = `W/"${size}-${Math.floor(stat.mtimeMs)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  // Never inline SVG (defense-in-depth against XSS vectors)
  const baseType = String(contentType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const effectiveDisposition =
    baseType === "image/svg+xml" ? "attachment" : disposition;

  res.setHeader(
    "Content-Disposition",
    `${effectiveDisposition}; filename="${encodeURIComponent(fileName)}"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("Last-Modified", stat.mtime.toUTCString());

  // Conditional GET
  const inm = req.headers["if-none-match"];
  if (req.method === "GET" && inm && inm === etag) {
    res.status(304).end();
    return;
  }

  // HEAD: headers only
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(size));
    res.status(200).end();
    return;
  }

  // GET with optional Range
  const range = req.headers.range;
  if (range) {
    // Example "bytes=0-1023" or "bytes=1024-"
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    let start = parseInt(m[1], 10);
    let end = m[2] ? parseInt(m[2], 10) : size - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start > end ||
      start >= size
    ) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    end = Math.min(end, size - 1);
    const chunkLen = end - start + 1;

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(chunkLen));

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", (e) => {
      try {
        res.destroy(e);
      } catch {}
    });
    stream.pipe(res);
    return;
  }

  // Full body
  res.setHeader("Content-Length", String(size));
  const stream = fs.createReadStream(filePath);
  stream.on("error", (e) => {
    try {
      res.destroy(e);
    } catch {}
  });
  stream.pipe(res);
}

function chunkDirFor(fingerprint: string) {
  return safeResolveUnder(STORAGE_DIR, "chunks", fingerprint);
}

function removeChunkUploadDirByPath(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function removeChunkUploadDir(fingerprint: string): boolean {
  const safeFingerprint = normalizeFingerprint(fingerprint);
  return removeChunkUploadDirByPath(chunkDirFor(safeFingerprint));
}

function cleanupExpiredChunkUploadDirs(maxAgeMs = CHUNK_UPLOAD_TTL_MS) {
  const chunksRoot = safeResolveUnder(STORAGE_DIR, "chunks");
  if (!fs.existsSync(chunksRoot)) return;

  const now = Date.now();

  for (const entry of fs.readdirSync(chunksRoot)) {
    if (!FINGERPRINT_RE.test(entry)) continue;

    const dir = safeResolveUnder(chunksRoot, entry);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    const lastTouchedMs = Math.max(stat.mtimeMs, stat.ctimeMs);
    if (now - lastTouchedMs > maxAgeMs) {
      removeChunkUploadDirByPath(dir);
    }
  }
}

function finalFilePathFor(fingerprint: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return safeResolveUnder(STORAGE_DIR, "files", `${fingerprint}__${safeName}`);
}

async function stitchChunksToFile(
  dir: string,
  total: number,
  finalPath: string,
) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const write = fs.createWriteStream(finalPath);
  await new Promise<void>(async (resolve, reject) => {
    write.on("error", reject);
    try {
      for (let i = 0; i < total; i++) {
        const p = path.join(dir, `${i}.part`);
        const data = fs.readFileSync(p);
        if (!write.write(data)) {
          await new Promise<void>((resolve) =>
            write.once("drain", () => resolve()),
          );
        }
      }
      write.end();
      write.once("finish", () => resolve());
    } catch (e) {
      reject(e);
    }
  });
}

function inferMimeType(fileName: string, fallback: string): string {
  return inferCanonicalMime(fileName, fallback);
}

function readHeadBytes(filePath: string, length = 4096): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function looksBinarySample(sample: Buffer): boolean {
  if (!sample.length) return false;

  let nulCount = 0;
  let suspiciousControlCount = 0;

  for (const b of sample) {
    if (b === 0) {
      nulCount += 1;
      continue;
    }

    const isTabOrLineBreak = b === 9 || b === 10 || b === 13;
    const isAsciiPrintable = b >= 32 && b <= 126;
    const isExtendedByte = b >= 128; // allow utf-8 / unicode bytes

    if (!isTabOrLineBreak && !isAsciiPrintable && !isExtendedByte) {
      suspiciousControlCount += 1;
    }
  }

  return nulCount > 0 || suspiciousControlCount / sample.length > 0.1;
}

async function validateFinalizedUpload(
  filePath: string,
  fileName: string,
  fallbackMime: string,
): Promise<
  | {
      ok: true;
      effectiveMime: string;
      capability: ReturnType<typeof getFileCapability>;
    }
  | {
      ok: false;
      code: "UNSUPPORTED_MEDIA";
      message: string;
    }
> {
  const capability = getFileCapability(fileName, fallbackMime);
  const effectiveMime = inferMimeType(fileName, fallbackMime);

  if (!capability.uploadAllowed) {
    return {
      ok: false,
      code: "UNSUPPORTED_MEDIA",
      message: "Unsupported file type",
    };
  }

  if (capability.validation === "magic") {
    const { fileTypeFromFile } = await import("file-type");
    const ft = await fileTypeFromFile(filePath);
    const actualMime = String(ft?.mime || "").toLowerCase();

    if (!actualMime || actualMime !== capability.canonicalMime) {
      return {
        ok: false,
        code: "UNSUPPORTED_MEDIA",
        message: `Uploaded content does not match ${capability.canonicalMime}`,
      };
    }
  }

  if (capability.validation === "text-sniff") {
    const head = readHeadBytes(filePath, 4096);
    if (looksBinarySample(head)) {
      return {
        ok: false,
        code: "UNSUPPORTED_MEDIA",
        message: "Expected a text-like file but received binary content",
      };
    }
  }

  return {
    ok: true,
    effectiveMime,
    capability,
  };
}

// ---- Archive safety limits (DoS hardening) ----
const MAX_ARCHIVE_ENTRIES_SCAN = 5000; // cap how many entries we inspect
const MAX_ARCHIVE_LIST_BYTES = 2 * 1024 * 1024; // 2MB max JSON response for listing/search
const MAX_ARCHIVE_ENTRY_STREAM_BYTES = 50 * 1024 * 1024; // 50MB max streamed entry

function isSafeArchivePath(p: string) {
  const s = String(p || "");
  if (!s) return false;
  if (s.includes("\0")) return false;
  if (s.startsWith("/") || s.startsWith("\\")) return false;
  if (s.includes("..")) return false; // blocks zip-slip
  return true;
}

async function requireZipFileOr400(id: string) {
  const f = await prisma.storedFile.findUnique({ where: { id } });
  if (!f)
    return {
      ok: false as const,
      res: { status: 404, message: "File not found" },
    };
  const name = String(f.fileName || "").toLowerCase();
  const mime = String(f.mimeType || "").toLowerCase();
  const looksZip = name.endsWith(".zip") || mime === "application/zip";
  if (!looksZip)
    return {
      ok: false as const,
      res: { status: 400, message: "Not a zip archive" },
    };
  return { ok: true as const, file: f };
}

type ArchiveIndexEntry = {
  path: string;
  size: number;
  compressedSize: number;
  modified: string | null;
  isDirectory: boolean;
};

type ArchiveDirectoryListing = {
  folders: string[];
  files: Array<{
    name: string;
    size: number;
    compressedSize: number;
    modified: string | null;
  }>;
};

type ArchiveIndex = {
  cacheKey: string;
  builtAt: number;
  truncated: boolean;
  entries: ArchiveIndexEntry[];
  entryByPath: Map<string, ArchiveIndexEntry>;
  childrenByPrefix: Map<string, ArchiveDirectoryListing>;
};

const ARCHIVE_INDEX_TTL_MS = (() => {
  const n = Number(process.env.ARCHIVE_INDEX_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
})();

const MAX_ARCHIVE_INDEX_ITEMS = (() => {
  const n = Number(process.env.MAX_ARCHIVE_INDEX_ITEMS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 16;
})();

const archiveIndexCache = new Map<string, ArchiveIndex>();

function normalizeArchiveEntryPath(input: string): string {
  return String(input || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

function normalizeArchivePrefix(input: string): string {
  const normalized = normalizeArchiveEntryPath(input);
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function archiveNameCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function safeArchiveModifiedIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as any);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function makeArchiveCacheKey(zipPath: string): string {
  const stat = fs.statSync(zipPath);
  return `${zipPath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
}

function touchArchiveIndexCache(key: string, value: ArchiveIndex) {
  archiveIndexCache.delete(key);
  archiveIndexCache.set(key, value);

  while (archiveIndexCache.size > MAX_ARCHIVE_INDEX_ITEMS) {
    const oldestKey = archiveIndexCache.keys().next().value;
    if (!oldestKey) break;
    archiveIndexCache.delete(oldestKey);
  }
}

async function buildArchiveIndex(zipPath: string): Promise<ArchiveIndex> {
  const zip = await unzipper.Open.file(zipPath);

  const entries: ArchiveIndexEntry[] = [];
  const entryByPath = new Map<string, ArchiveIndexEntry>();

  const listingState = new Map<
    string,
    {
      folders: Set<string>;
      files: ArchiveDirectoryListing["files"];
    }
  >();

  const ensureListingState = (prefix: string) => {
    const key = normalizeArchivePrefix(prefix);
    let current = listingState.get(key);
    if (!current) {
      current = { folders: new Set<string>(), files: [] };
      listingState.set(key, current);
    }
    return current;
  };

  ensureListingState("");

  let scanned = 0;
  let truncated = false;

  for (const raw of zip.files) {
    scanned += 1;
    if (scanned > MAX_ARCHIVE_ENTRIES_SCAN) {
      truncated = true;
      break;
    }

    const rawPath = normalizeArchiveEntryPath(String((raw as any)?.path || ""));
    if (!rawPath) continue;

    const rawType = String((raw as any)?.type || "").toLowerCase();
    const isDirectory = rawType === "directory" || rawPath.endsWith("/");

    const normalizedPath = isDirectory
      ? `${rawPath.replace(/\/+$/, "")}/`
      : rawPath;

    const safePath = isDirectory
      ? normalizedPath.replace(/\/+$/, "")
      : normalizedPath;

    if (!safePath || !isSafeArchivePath(safePath)) continue;

    const barePath = isDirectory
      ? normalizedPath.replace(/\/+$/, "")
      : normalizedPath;

    const segments = barePath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    for (let i = 0; i < segments.length - 1; i += 1) {
      const parentPrefix = i === 0 ? "" : `${segments.slice(0, i).join("/")}/`;
      const childFolderName = segments[i];

      ensureListingState(parentPrefix).folders.add(childFolderName);
      ensureListingState(`${segments.slice(0, i + 1).join("/")}/`);
    }

    const entry: ArchiveIndexEntry = {
      path: normalizedPath,
      size: Number(
        (raw as any)?.uncompressedSize ||
          (raw as any)?.vars?.uncompressedSize ||
          0,
      ),
      compressedSize: Number(
        (raw as any)?.compressedSize || (raw as any)?.vars?.compressedSize || 0,
      ),
      modified: safeArchiveModifiedIso(
        (raw as any)?.props?.lastModifiedDateTime ||
          (raw as any)?.props?.lastModifiedDate ||
          (raw as any)?.vars?.lastModifiedDate ||
          null,
      ),
      isDirectory,
    };

    entries.push(entry);
    entryByPath.set(entry.path, entry);

    if (isDirectory) {
      const parentPrefix =
        segments.length === 1 ? "" : `${segments.slice(0, -1).join("/")}/`;
      const folderName = segments[segments.length - 1];

      ensureListingState(parentPrefix).folders.add(folderName);
      ensureListingState(`${barePath}/`);
    } else {
      const parentPrefix =
        segments.length === 1 ? "" : `${segments.slice(0, -1).join("/")}/`;
      const fileName = segments[segments.length - 1];

      ensureListingState(parentPrefix).files.push({
        name: fileName,
        size: entry.size,
        compressedSize: entry.compressedSize,
        modified: entry.modified,
      });
    }
  }

  const childrenByPrefix = new Map<string, ArchiveDirectoryListing>();

  for (const [prefix, state] of listingState.entries()) {
    childrenByPrefix.set(prefix, {
      folders: [...state.folders].sort(archiveNameCompare),
      files: [...state.files].sort((a, b) =>
        archiveNameCompare(a.name, b.name),
      ),
    });
  }

  return {
    cacheKey: makeArchiveCacheKey(zipPath),
    builtAt: Date.now(),
    truncated,
    entries,
    entryByPath,
    childrenByPrefix,
  };
}

async function getArchiveIndex(zipPath: string): Promise<ArchiveIndex> {
  const cacheKey = makeArchiveCacheKey(zipPath);
  const cached = archiveIndexCache.get(cacheKey);

  if (cached && Date.now() - cached.builtAt <= ARCHIVE_INDEX_TTL_MS) {
    touchArchiveIndexCache(cacheKey, cached);
    return cached;
  }

  for (const existingKey of [...archiveIndexCache.keys()]) {
    if (existingKey.startsWith(`${zipPath}:`) && existingKey !== cacheKey) {
      archiveIndexCache.delete(existingKey);
    }
  }

  const fresh = await buildArchiveIndex(zipPath);
  touchArchiveIndexCache(cacheKey, fresh);
  return fresh;
}

function prismaSupportsFolders(): boolean {
  // When Prisma client hasn't been regenerated, `prisma.folder` may be undefined
  return typeof (prisma as any).folder?.findMany === "function";
}

function folderSchemaOutOfSyncMessage(): string {
  return "Folder filtering is unavailable because the deployed Prisma client or database schema is out of sync. Run Prisma migrate/generate and restart the server.";
}

function isUnknownFolderIdError(error: any): boolean {
  return String(error?.message || "").includes("Unknown argument `folderId`");
}

type StoredFileScopeParams = {
  q?: string;
  tags?: string;
  mimeTypes?: string;
  visibility?: string;
  favoritesOnly?: string;
  captureKind?: string;
  integrity?: string;
  revision?: string;
  sourceDomain?: string;
  taggingStatus?: string;
  metadataState?: string;
  folderId?: string;
};

function metadataMissingWhereClause() {
  return {
    OR: [
      { sourcePublishedAt: null },
      { sourceAuthors: { isEmpty: true } },
      { tags: { isEmpty: true } },
    ],
  };
}

function buildStoredFileScopeWhere(params: StoredFileScopeParams) {
  const {
    q,
    tags,
    mimeTypes,
    visibility,
    favoritesOnly,
    captureKind,
    integrity,
    revision,
    sourceDomain,
    taggingStatus,
    metadataState,
    folderId,
  } = params;

  const where: any = {
    deletedAt: null,
  };

  const andClauses: any[] = [];

  if (q && q.trim()) {
    const term = q.trim();
    const searchTokens = Array.from(
      new Set(
        term
          .split(/[,\s]+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2),
      ),
    ).slice(0, 8);

    andClauses.push({
      OR: [
        { fileName: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { sourceUrl: { contains: term, mode: "insensitive" } },
        { uploaderName: { contains: term, mode: "insensitive" } },
        ...(searchTokens.length
          ? [
              { tags: { hasSome: searchTokens } },
              { sourceAuthors: { hasSome: searchTokens } },
              {
                url: {
                  is: {
                    authors: { hasSome: searchTokens },
                  },
                },
              },
            ]
          : []),
      ],
    });
  }

  if (tags) {
    const arr = String(tags)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (arr.length) {
      andClauses.push({ tags: { hasEvery: arr } });
    }
  }

  if (mimeTypes) {
    const arr = String(mimeTypes)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (arr.length) {
      andClauses.push({ mimeType: { in: arr } });
    }
  }

  if (visibility && (visibility === "public" || visibility === "private")) {
    andClauses.push({ visibility });
  }

  if (favoritesOnly === "true") {
    andClauses.push({ isFavorited: true });
  }

  if (captureKind === "upload") {
    andClauses.push({ captureType: "UPLOAD" });
  } else if (captureKind === "web") {
    andClauses.push({
      captureType: { in: ["URL_TEXT", "URL_PDF"] },
    });
  }

  if (integrity === "verified") {
    andClauses.push({ sha256: { not: null } });
  } else if (integrity === "hashed") {
    andClauses.push({
      OR: [{ sha256: { not: null } }, { contentHash: { not: null } }],
    });
  } else if (integrity === "pending") {
    andClauses.push({ sha256: null, contentHash: null });
  }

  if (revision === "revisioned") {
    andClauses.push({ documentRevision: { isNot: null } });
  } else if (revision === "base") {
    andClauses.push({ documentRevision: { is: null } });
  }

  if (sourceDomain && sourceDomain.trim()) {
    andClauses.push({
      sourceUrl: {
        contains: sourceDomain.trim(),
        mode: "insensitive",
      },
    });
  }

  if (
    taggingStatus &&
    ["NONE", "PENDING", "RUNNING", "SUCCESS", "FAILED"].includes(taggingStatus)
  ) {
    andClauses.push({ taggingStatus: taggingStatus as any });
  }

  if (metadataState === "missing") {
    andClauses.push(metadataMissingWhereClause());
  } else if (metadataState === "complete") {
    andClauses.push({
      sourcePublishedAt: { not: null },
      sourceAuthors: { isEmpty: false },
      tags: { isEmpty: false },
    });
  }

  if (typeof folderId === "string") {
    if (!prismaSupportsFolders()) {
      const error: any = new Error(folderSchemaOutOfSyncMessage());
      error.code = "FOLDER_SCHEMA_OUT_OF_SYNC";
      throw error;
    }

    if (folderId === "root" || folderId === "") where.folderId = null;
    else where.folderId = folderId;
  }

  if (andClauses.length) {
    where.AND = andClauses;
  }

  return where;
}

function withAdditionalStoredFileClause(baseWhere: any, clause: any) {
  const andClauses = Array.isArray(baseWhere.AND) ? [...baseWhere.AND] : [];
  return {
    ...baseWhere,
    AND: [...andClauses, clause],
  };
}

function isFolderScopeUnavailableError(error: any): boolean {
  return (
    error?.code === "FOLDER_SCHEMA_OUT_OF_SYNC" || isUnknownFolderIdError(error)
  );
}

// --- helpers (add once) ---
function normalizeMime(m?: string) {
  return (m || "").toLowerCase().split(";")[0].trim();
}

function isInlinePreviewable(contentType: string) {
  const base = normalizeMime(contentType);
  if (!base) return false;
  if (base.startsWith("image/")) return base !== "image/svg+xml"; // never inline SVG
  if (base.startsWith("text/")) return true; // text/plain; charset=utf-8, text/markdown, text/csv, ...
  if (base === "application/pdf") return true;
  if (base === "application/json" || base.endsWith("+json")) return true; // json, openapi+json, etc.
  return false;
}

// helper: generate a new storage path alongside the source file
function newStoragePathLike(srcPath: string, fileName: string) {
  const dir = path.dirname(srcPath);
  const hex = crypto.randomBytes(12).toString("hex"); // 24-hex like your existing naming
  return path.join(dir, `${hex}__${fileName}`);
}
// --- end helpers ---

async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("data", (d) => h.update(d));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex")));
  });
}

// POST /api/files/upload/chunk
// Fields: chunk (blob), fingerprint, chunkIndex, totalChunks, fileName
r.post(
  "/files/upload/chunk",
  chunkUpload.single("chunk"),
  async (req, res, next) => {
    try {
      cleanupExpiredChunkUploadDirs();
      const { fingerprint, chunkIndex, totalChunks, fileName, folderId } =
        req.body as Record<string, string>;
      if (!fingerprint || !fileName)
        return res
          .status(400)
          .json({ message: "Missing fingerprint or fileName" });
      if (!req.file) return res.status(400).json({ message: "Missing chunk" });

      let safeFingerprint: string;
      try {
        safeFingerprint = normalizeFingerprint(fingerprint);
      } catch {
        return res.status(400).json({ message: "Invalid fingerprint" });
      }

      const safeFileName = sanitizeFilename(fileName);

      const idx = Number(chunkIndex);
      const total = Number(totalChunks);

      // hard limits to prevent disk fill / abuse
      const MAX_TOTAL_CHUNKS = 2000;

      if (!Number.isInteger(idx) || !Number.isInteger(total)) {
        return res
          .status(400)
          .json({ message: "Invalid chunkIndex/totalChunks" });
      }
      if (total <= 0 || total > MAX_TOTAL_CHUNKS || idx < 0 || idx >= total) {
        return res.status(400).json({ message: "Invalid chunk bounds" });
      }

      const dir = chunkDirFor(safeFingerprint);
      fs.mkdirSync(dir, { recursive: true });
      const chunkPath = path.join(dir, `${idx}.part`);
      fs.writeFileSync(chunkPath, req.file.buffer);

      // Attempt auto-finalize when all parts are present
      const parts = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".part"))
        .map((f) => Number(f.replace(".part", "")));
      const haveAll =
        parts.length === total &&
        parts.every((n) => Number.isInteger(n)) &&
        parts.sort((a, b) => a - b)[0] === 0 &&
        parts.sort((a, b) => a - b)[parts.length - 1] === total - 1;

      if (haveAll) {
        const finalPath = finalFilePathFor(safeFingerprint, safeFileName);

        await stitchChunksToFile(dir, total, finalPath);

        // Validate the stitched file against the canonical capability matrix
        const validation = await validateFinalizedUpload(
          finalPath,
          safeFileName,
          req.file?.mimetype || "application/octet-stream",
        );

        if (!validation.ok) {
          try {
            fs.unlinkSync(finalPath);
          } catch {}
          for (let i = 0; i < total; i++) {
            try {
              fs.unlinkSync(path.join(dir, `${i}.part`));
            } catch {}
          }
          try {
            fs.rmdirSync(dir);
          } catch {}

          return res.status(415).json({
            code: validation.code,
            message: validation.message,
          });
        }

        const canonicalMime = validation.effectiveMime;
        const capability = validation.capability;
        const aiTaggingError = capability.aiTagSupported
          ? null
          : getAiTaggingUnavailableMessage(safeFileName, canonicalMime);

        // Cleanup chunks on success
        for (let i = 0; i < total; i++) {
          try {
            fs.unlinkSync(path.join(dir, `${i}.part`));
          } catch {}
        }
        try {
          fs.rmdirSync(dir);
        } catch {}

        // Continue with stat + DB upsert ...
        const stat = fs.statSync(finalPath);
        if (stat.size > MAX_UPLOAD_BYTES) {
          try {
            fs.unlinkSync(finalPath);
          } catch {}
          return res.status(413).json({
            code: "PAYLOAD_TOO_LARGE",
            message: "File too large",
            maxBytes: MAX_UPLOAD_BYTES,
          });
        }

        const sha256 = await sha256File(finalPath);

        const updateData: any = {
          fileName: safeFileName,
          mimeType: canonicalMime,
          size: stat.size,
          uploaderId: "self",
          uploaderName: "You",
          storagePath: finalPath,
          sha256,
          contentHash: null,
          taggerVersion: null,
          taggingStatus: capability.aiTagSupported ? "PENDING" : "NONE",
          taggingJobId: null,
          taggingError: aiTaggingError,
        };
        const createData: any = {
          id: safeFingerprint,
          fileName: safeFileName,
          mimeType: canonicalMime,
          size: stat.size,
          uploaderId: updateData.uploaderId,
          uploaderName: updateData.uploaderName,
          storagePath: finalPath,
          sha256,
          contentHash: null,
          taggerVersion: null,
          taggingStatus: capability.aiTagSupported ? "PENDING" : "NONE",
          taggingJobId: null,
          taggingError: aiTaggingError,
        };

        if (prismaSupportsFolders()) {
          updateData.folderId =
            typeof folderId === "string" && folderId.trim()
              ? folderId.trim()
              : null;
          createData.folderId =
            typeof folderId === "string" && folderId.trim()
              ? folderId.trim()
              : null;
        }
        const rec = await prisma.storedFile.upsert({
          where: { id: fingerprint },
          update: updateData,
          create: createData,
        });

        // provenance capture event for upload finalize (chunked)
        const docRev = await ensureDocumentRevisionForStoredFile(
          String(rec.id),
        );

        await recordCaptureEvent({
          pipelineName: "upload.chunk.autofinalize",
          pipelineConfig: { sha256: true, chunkedUpload: true },
          captureType: "UPLOAD",
          storedFileId: String(rec.id),
          documentRevisionId: docRev.id,
          urlId: rec.urlId ?? null,
          sourceUrl: rec.sourceUrl ?? null,
          actorId: rec.uploaderId ?? null,
          actorName: rec.uploaderName ?? null,
          requestId: (req as any)?.requestId ?? null,
        });

        // Kick async tagging only for file types supported by the current extractor
        try {
          const capability = getFileCapability(rec.fileName, rec.mimeType);
          if (capability.aiTagSupported) {
            const { scheduleAiTagForFile } =
              await import("../services/aiTagAuto.service");
            scheduleAiTagForFile(String(rec.id));
          }
        } catch (e) {
          console.error("aiTagAuto import failed", e);
        }
      }

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/files/upload/chunk/:fingerprint
// Cancel a chunked upload and remove any partial chunk files
r.delete("/files/upload/chunk/:fingerprint", async (req, res, next) => {
  try {
    cleanupExpiredChunkUploadDirs();

    let safeFingerprint: string;
    try {
      safeFingerprint = normalizeFingerprint(req.params.fingerprint);
    } catch {
      return res.status(400).json({ message: "Invalid fingerprint" });
    }

    const removed = removeChunkUploadDir(safeFingerprint);

    return res.json({
      ok: true,
      fingerprint: safeFingerprint,
      removed,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/files/:id/trash  → soft delete
r.patch("/files/:id/trash", async (req, res) => {
  const id = String(req.params.id);

  // Optional: prevent double-delete
  const existing = await prisma.storedFile.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  if (existing.deletedAt) {
    return res.status(409).json({
      message:
        "Trashed folders are read-only. Restore the folder before renaming or moving it.",
    });
  }
  if (existing.deletedAt)
    return res.status(409).json({ message: "Already in trash" });

  const updated = await prisma.storedFile.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  res.json(updated);
});

// PATCH /api/files/:id/restore  → clear deletedAt
r.patch("/files/:id/restore", async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.storedFile.findUnique({ where: { id } });

  if (!existing) return res.status(404).json({ message: "Not found" });
  if (!existing.deletedAt)
    return res.status(409).json({ message: "Not in trash" });

  const updated = await prisma.storedFile.update({
    where: { id },
    data: { deletedAt: null },
  });

  res.json(updated);
});

// GET /api/trash → list trashed items
r.get("/trash", async (req, res, next) => {
  try {
    const {
      q,
      sortKey = "deletedAt",
      sortOrder = "desc",
      page,
      pageSize,
      offset,
      limit,
    } = req.query as Record<string, string>;

    const where: any = { deletedAt: { not: null } };

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      where.OR = [
        { fileName: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ];
    }

    const orderBy: any = {};
    if (
      ["deletedAt", "createdAt", "fileName", "size"].includes(String(sortKey))
    ) {
      orderBy[String(sortKey)] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.deletedAt = "desc";
    }

    const folders = prismaSupportsFolders()
      ? await prisma.folder.findMany({
          where: { deletedAt: { not: null } },
          orderBy: { deletedAt: "desc" },
        })
      : [];

    const hasOffsetPagination =
      Number.isInteger(Number(offset)) && Number.isInteger(Number(limit));
    const hasPagePagination =
      Number.isInteger(Number(page)) && Number.isInteger(Number(pageSize));

    if (hasOffsetPagination || hasPagePagination) {
      const skip = hasOffsetPagination
        ? Math.max(0, Number(offset))
        : (Math.max(1, Number(page)) - 1) *
          Math.min(100, Math.max(1, Number(pageSize)));

      const take = hasOffsetPagination
        ? Math.min(100, Math.max(0, Number(limit)))
        : Math.min(100, Math.max(1, Number(pageSize)));

      const responsePage = hasPagePagination
        ? Math.max(1, Number(page))
        : Math.floor(skip / Math.max(1, take || 1)) + 1;

      const responsePageSize = hasPagePagination
        ? Math.min(100, Math.max(1, Number(pageSize)))
        : take;

      const [files, total, sum] = await Promise.all([
        take === 0
          ? Promise.resolve([] as any[])
          : prisma.storedFile.findMany({ where, orderBy, skip, take }),
        prisma.storedFile.count({ where }),
        prisma.storedFile.aggregate({ where, _sum: { size: true } }),
      ]);

      const totalBytes = sum?._sum?.size ?? 0;
      return res.json({
        files,
        folders,
        total,
        totalBytes,
        page: responsePage,
        pageSize: responsePageSize,
      });
    }

    // Non-paginated fallback (still returns totals)
    const [files, total, sum] = await Promise.all([
      prisma.storedFile.findMany({ where, orderBy }),
      prisma.storedFile.count({ where }),
      prisma.storedFile.aggregate({ where, _sum: { size: true } }),
    ]);

    const totalBytes = sum?._sum?.size ?? 0;
    return res.json({ files, folders, total, totalBytes });
  } catch (err) {
    next(err);
  }
});

// POST /api/files/finalize optional finalize request to stitch chunks and persist metadata
r.post("/files/finalize", async (req, res, next) => {
  try {
    cleanupExpiredChunkUploadDirs();
    const {
      fingerprint,
      fileName,
      mimeType,
      uploaderName = "You",
      uploaderId = "self",
      description = "",
      folderId,
    } = req.body ?? {};
    if (!fingerprint || !fileName) {
      return res
        .status(400)
        .json({ message: "fingerprint and fileName are required" });
    }

    let safeFingerprint: string;
    try {
      safeFingerprint = normalizeFingerprint(fingerprint);
    } catch {
      return res.status(400).json({ message: "Invalid fingerprint" });
    }

    const safeFileName = sanitizeFilename(fileName);

    const dir = chunkDirFor(safeFingerprint);
    if (!fs.existsSync(dir))
      return res.status(400).json({ message: "No chunks found to finalize" });

    const partFiles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".part"))
      .sort(
        (a, b) => Number(a.split(".part")[0]) - Number(b.split(".part")[0]),
      );

    const finalPath = finalFilePathFor(safeFingerprint, safeFileName);
    await stitchChunksToFile(dir, partFiles.length, finalPath);

    // cleanup chunk dir
    for (const pf of partFiles) {
      fs.unlinkSync(path.join(dir, pf));
    }
    fs.rmdirSync(dir);

    // persist metadata in DB (upsert in case finalize called multiple times)
    // Determine final size
    const stat = fs.statSync(finalPath);
    if (stat.size > MAX_UPLOAD_BYTES) {
      try {
        fs.unlinkSync(finalPath);
      } catch {}
      return res.status(413).json({
        code: "PAYLOAD_TOO_LARGE",
        message: "File too large",
        maxBytes: MAX_UPLOAD_BYTES,
      });
    }

    const validation = await validateFinalizedUpload(
      finalPath,
      safeFileName,
      mimeType || "application/octet-stream",
    );

    if (!validation.ok) {
      try {
        fs.unlinkSync(finalPath);
      } catch {}
      return res.status(415).json({
        code: validation.code,
        message: validation.message,
      });
    }

    const finalMime = validation.effectiveMime;
    const capability = validation.capability;
    const aiTaggingError = capability.aiTagSupported
      ? null
      : getAiTaggingUnavailableMessage(safeFileName, finalMime);

    const sha256 = await sha256File(finalPath);

    // Best-effort file metadata extraction (PDF only)
    let sourcePublishedAt: Date | null = null;
    let sourceAuthors: string[] = [];

    if (
      finalMime.includes("pdf") ||
      safeFileName.toLowerCase().endsWith(".pdf")
    ) {
      const meta = await extractPdfFileMetadata(finalPath);
      sourcePublishedAt = meta.sourcePublishedAt;
      sourceAuthors = meta.sourceAuthors;
    }

    const updateData: any = {
      fileName: safeFileName,
      mimeType: finalMime,
      size: stat.size,
      sourcePublishedAt,
      sourceAuthors,
      description,
      uploaderId,
      uploaderName,
      storagePath: finalPath,
      sha256,
      contentHash: null,
      taggerVersion: null,
      taggingStatus: capability.aiTagSupported ? "PENDING" : "NONE",
      taggingJobId: null,
      taggingError: aiTaggingError,
    };
    const createData: any = {
      id: fingerprint,
      fileName: safeFileName,
      mimeType: finalMime,
      size: stat.size,
      sourcePublishedAt,
      sourceAuthors,
      description,
      uploaderId,
      uploaderName,
      storagePath: finalPath,
      sha256,
      contentHash: null,
      taggerVersion: null,
      taggingStatus: capability.aiTagSupported ? "PENDING" : "NONE",
      taggingJobId: null,
      taggingError: aiTaggingError,
    };

    if (prismaSupportsFolders()) {
      updateData.folderId =
        typeof folderId === "string" && folderId.trim()
          ? folderId.trim()
          : null;
      createData.folderId =
        typeof folderId === "string" && folderId.trim()
          ? folderId.trim()
          : null;
    }

    const record = await prisma.storedFile.upsert({
      where: { id: fingerprint },
      update: updateData,
      create: createData,
    });
    // provenance capture event for upload finalize (manual finalize)
    const docRev = await ensureDocumentRevisionForStoredFile(String(record.id));

    await recordCaptureEvent({
      pipelineName: "upload.finalize",
      pipelineConfig: { sha256: true, chunkedUpload: true },
      captureType: "UPLOAD",
      storedFileId: String(record.id),
      documentRevisionId: docRev.id,
      urlId: record.urlId ?? null,
      sourceUrl: record.sourceUrl ?? null,
      actorId: record.uploaderId ?? null,
      actorName: record.uploaderName ?? null,
      requestId: (req as any)?.requestId ?? null,
    });

    res.json(record);

    // Kick async tagging only for file types supported by the current extractor
    try {
      const capability = getFileCapability(record.fileName, record.mimeType);
      if (capability.aiTagSupported) {
        const { scheduleAiTagForFile } =
          await import("../services/aiTagAuto.service");
        scheduleAiTagForFile(String(record.id));
      }
    } catch (e) {
      console.error("aiTagAuto import failed", e);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/files
// Supports optional filtering and pagination
// Query: q, tags (csv), mimeTypes (csv), visibility, favoritesOnly,
// captureKind (all|upload|web), integrity (all|verified|hashed|pending),
// revision (all|revisioned|base), sourceDomain, taggingStatus, metadataState,
// sortKey (createdAt|fileName|size), sortOrder (asc|desc), page, pageSize, folderId
r.get("/files", async (req, res, next) => {
  try {
    const {
      q,
      tags,
      mimeTypes,
      visibility,
      favoritesOnly,
      captureKind,
      integrity,
      revision,
      sourceDomain,
      taggingStatus,
      metadataState,
      sortKey = "createdAt",
      sortOrder = "desc",
      page,
      pageSize,
      offset,
      limit,
      folderId,
    } = req.query as Record<string, string>;

    let where: any;
    try {
      where = buildStoredFileScopeWhere({
        q,
        tags,
        mimeTypes,
        visibility,
        favoritesOnly,
        captureKind,
        integrity,
        revision,
        sourceDomain,
        taggingStatus,
        metadataState,
        folderId,
      });
    } catch (e: any) {
      if (isFolderScopeUnavailableError(e)) {
        return res.status(503).json({
          message: folderSchemaOutOfSyncMessage(),
        });
      }
      throw e;
    }

    const orderBy: any = {};
    if (
      ["createdAt", "fileName", "size", "mimeType"].includes(String(sortKey))
    ) {
      orderBy[String(sortKey)] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const fileInclude = {
      url: {
        select: {
          publishedAt: true,
          authors: true,
        },
      },
      documentRevision: {
        select: {
          id: true,
          documentId: true,
          ordinal: true,
          createdAt: true,
          captureType: true,
          contentHash: true,
          storedFileId: true,
        },
      },
      captureEvent: {
        select: {
          id: true,
          createdAt: true,
          requestId: true,
          actorId: true,
          actorName: true,
          sourceUrl: true,
          urlId: true,
          pipelineConfig: {
            select: {
              id: true,
              name: true,
              version: true,
              configHash: true,
              codeSha: true,
              createdAt: true,
            },
          },
        },
      },
    };

    const hasOffsetPagination =
      Number.isInteger(Number(offset)) && Number.isInteger(Number(limit));
    const hasPagePagination =
      Number.isInteger(Number(page)) && Number.isInteger(Number(pageSize));

    if (hasOffsetPagination || hasPagePagination) {
      const skip = hasOffsetPagination
        ? Math.max(0, Number(offset))
        : (Math.max(1, Number(page)) - 1) *
          Math.min(100, Math.max(1, Number(pageSize)));

      const take = hasOffsetPagination
        ? Math.min(100, Math.max(0, Number(limit)))
        : Math.min(100, Math.max(1, Number(pageSize)));

      const responsePage = hasPagePagination
        ? Math.max(1, Number(page))
        : Math.floor(skip / Math.max(1, take || 1)) + 1;

      const responsePageSize = hasPagePagination
        ? Math.min(100, Math.max(1, Number(pageSize)))
        : take;

      try {
        const [items, total, sum] = await Promise.all([
          take === 0
            ? Promise.resolve([] as any[])
            : prisma.storedFile.findMany({
                where,
                orderBy,
                skip,
                take,
                include: fileInclude,
              }),
          prisma.storedFile.count({ where }),
          prisma.storedFile.aggregate({ where, _sum: { size: true } }),
        ]);

        const totalBytes = sum?._sum?.size ?? 0;
        return res.json({
          items,
          total,
          totalBytes,
          page: responsePage,
          pageSize: responsePageSize,
        });
      } catch (e: any) {
        if (isUnknownFolderIdError(e)) {
          return res.status(503).json({
            message: folderSchemaOutOfSyncMessage(),
          });
        }

        throw e;
      }
    }

    try {
      const files = await prisma.storedFile.findMany({
        where,
        orderBy,
        include: fileInclude,
      });
      res.json(files);
    } catch (e: any) {
      if (isUnknownFolderIdError(e)) {
        return res.status(503).json({
          message: folderSchemaOutOfSyncMessage(),
        });
      }

      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/files/review-queue-counts
r.post("/files/review-queue-counts", async (req, res, next) => {
  try {
    const scope = ((req.body as any)?.scope ?? {}) as StoredFileScopeParams;
    const reviewedAtByIdRaw = (req.body as any)?.reviewedAtById ?? {};
    const reviewedAtById =
      reviewedAtByIdRaw && typeof reviewedAtByIdRaw === "object"
        ? reviewedAtByIdRaw
        : {};

    let baseWhere: any;
    try {
      baseWhere = buildStoredFileScopeWhere(scope);
    } catch (e: any) {
      if (isFolderScopeUnavailableError(e)) {
        return res.status(503).json({
          message: folderSchemaOutOfSyncMessage(),
        });
      }
      throw e;
    }

    const [all, aiFailed, metadataMissing, hashPending, scopedFiles] =
      await Promise.all([
        prisma.storedFile.count({ where: baseWhere }),
        prisma.storedFile.count({
          where: withAdditionalStoredFileClause(baseWhere, {
            taggingStatus: "FAILED",
          }),
        }),
        prisma.storedFile.count({
          where: withAdditionalStoredFileClause(
            baseWhere,
            metadataMissingWhereClause(),
          ),
        }),
        prisma.storedFile.count({
          where: withAdditionalStoredFileClause(baseWhere, {
            sha256: null,
            contentHash: null,
          }),
        }),
        prisma.storedFile.findMany({
          where: baseWhere,
          select: { id: true, createdAt: true },
        }),
      ]);

    const updatedSinceReview = scopedFiles.reduce((count, file) => {
      const reviewedAt = String(
        (reviewedAtById as any)?.[file.id] ?? "",
      ).trim();
      if (!reviewedAt) return count + 1;

      const updatedMs = new Date(file.createdAt).getTime();
      const reviewedMs = new Date(reviewedAt).getTime();

      if (!Number.isFinite(updatedMs) || !Number.isFinite(reviewedMs)) {
        return count + 1;
      }

      return updatedMs > reviewedMs ? count + 1 : count;
    }, 0);

    return res.json({
      all,
      "ai-failed": aiFailed,
      "metadata-missing": metadataMissing,
      "hash-pending": hashPending,
      "updated-since-review": updatedSinceReview,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/storage/usage
// Returns the total stored bytes across all non-deleted files.
r.get("/storage/usage", async (_req, res, next) => {
  try {
    const agg = await prisma.storedFile.aggregate({
      where: { deletedAt: null },
      _sum: { size: true },
      _count: { _all: true },
    });

    const configuredCapacity = Number(process.env.STORAGE_CAPACITY_BYTES ?? "");
    const capacityBytes =
      Number.isFinite(configuredCapacity) && configuredCapacity > 0
        ? configuredCapacity
        : null;

    return res.json({
      usedBytes: agg._sum.size ?? 0,
      fileCount: agg._count._all ?? 0,
      capacityBytes,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id
r.get("/files/:id", async (req, res, next) => {
  try {
    const id = req.params.id;

    const f = await prisma.storedFile.findUnique({
      where: { id },
      include: {
        // if present, this is the “how it got created” event
        captureEvent: {
          include: {
            pipelineConfig: true,
            documentRevision: { include: { document: true } },
            url: { select: { publishedAt: true, authors: true } },
          },
        },

        // if present, this is the canonical revision anchor
        documentRevision: { include: { document: true } },
      },
    });

    if (!f) return res.status(404).json({ message: "Not found" });

    // Prefer direct docRev link; fallback to captureEvent’s docRev for older records
    const docRev =
      (f as any).documentRevision ??
      (f as any)?.captureEvent?.documentRevision ??
      null;

    const doc = docRev?.document ?? null;
    const pc = (f as any)?.captureEvent?.pipelineConfig ?? null;

    res.json({
      id: f.id,
      fileName: f.fileName,
      description: f.description ?? null,
      uploaderName: f.uploaderName,
      uploaderId: f.uploaderId ?? null,
      createdAt: f.createdAt,
      mimeType: f.mimeType,
      size: f.size,
      tags: f.tags,
      visibility: f.visibility,
      downloads: f.downloads,
      favoritesCount: f.favoritesCount,
      isFavorited: f.isFavorited,
      folderId: f.folderId ?? null,

      // ---- Provenance / traceability ----
      captureType: f.captureType,
      sourceUrl: f.sourceUrl ?? null,
      urlId: f.urlId ?? null,
      sourcePublishedAt:
        (f as any).sourcePublishedAt ?? (f as any).url?.publishedAt ?? null,
      sourceAuthors:
        ((f as any).sourceAuthors?.length ? (f as any).sourceAuthors : null) ??
        (f as any).url?.authors ??
        [],
      sha256: f.sha256 ?? null,
      contentHash: f.contentHash ?? null,
      taggerVersion: f.taggerVersion ?? null,
      tagsMeta: f.tagsMeta ?? null,
      taggingStatus: (f as any).taggingStatus ?? "NONE",
      taggingJobId: (f as any).taggingJobId ?? null,
      taggingError: (f as any).taggingError ?? null,

      document: doc
        ? {
            id: doc.id,
            kind: doc.kind,
            urlId: doc.urlId ?? null,
            primaryFileId: doc.primaryFileId ?? null,
          }
        : null,

      documentRevision: docRev
        ? {
            id: docRev.id,
            documentId: docRev.documentId,
            ordinal: docRev.ordinal,
            createdAt: docRev.createdAt,
            captureType: docRev.captureType,
            contentHash: docRev.contentHash ?? null,
            storedFileId: docRev.storedFileId,
          }
        : null,

      captureEvent: (f as any).captureEvent
        ? {
            id: (f as any).captureEvent.id,
            createdAt: (f as any).captureEvent.createdAt,
            requestId: (f as any).captureEvent.requestId ?? null,
            actorId: (f as any).captureEvent.actorId ?? null,
            actorName: (f as any).captureEvent.actorName ?? null,
            sourceUrl: (f as any).captureEvent.sourceUrl ?? null,
            urlId: (f as any).captureEvent.urlId ?? null,
            pipelineConfig: pc
              ? {
                  id: pc.id,
                  name: pc.name,
                  version: pc.version,
                  configHash: pc.configHash,
                  codeSha: pc.codeSha ?? null,
                  createdAt: pc.createdAt,
                }
              : null,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/files/:id/refresh-metadata
// Re-extracts publishedAt + authors for:
// - Uploaded PDFs (PDF info dict)
// - URL-derived files (re-fetch URL metadata; updates Url + StoredFile)
r.post("/files/:id/refresh-metadata", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();

    const f = await prisma.storedFile.findUnique({
      where: { id },
      include: { url: true },
    });

    if (!f) return res.status(404).json({ message: "Not found" });
    if (f.deletedAt)
      return res.status(410).json({ message: "File was deleted" });

    const contentType = inferMimeType(f.fileName, f.mimeType);

    let sourcePublishedAt: Date | null = null;
    let sourceAuthors: string[] = [];

    // If this is a PDF file stored locally, extract PDF metadata
    if (
      contentType.toLowerCase().includes("pdf") ||
      f.fileName.toLowerCase().endsWith(".pdf")
    ) {
      try {
        const meta = await extractPdfFileMetadata(f.storagePath);
        sourcePublishedAt = meta.sourcePublishedAt ?? null;
        sourceAuthors = Array.isArray(meta.sourceAuthors)
          ? meta.sourceAuthors
          : [];
      } catch {
        // ignore
      }
    }

    // If it has a source URL (URL_TEXT / URL_PDF / or manual sourceUrl), refresh from web
    const refreshUrl = (f.sourceUrl || (f as any).url?.url || "").trim();
    if (refreshUrl) {
      try {
        const meta = await extractUrlMetadata(refreshUrl);

        // update Url row if linked
        if (f.urlId) {
          await prisma.url.update({
            where: { id: f.urlId },
            data: {
              publishedAt: meta.publishedAt,
              authors: meta.authors ?? [],
            },
          });
        }

        // If file fields are empty (or PDF had no metadata), prefer URL metadata
        if (!sourcePublishedAt) sourcePublishedAt = meta.publishedAt ?? null;
        if (!sourceAuthors.length && Array.isArray(meta.authors))
          sourceAuthors = meta.authors;
      } catch {
        // ignore
      }
    }

    const updated = await prisma.storedFile.update({
      where: { id },
      data: {
        sourcePublishedAt,
        sourceAuthors,
      },
    });

    // provenance: record metadata refresh as a capture event
    try {
      const docRev = await ensureDocumentRevisionForStoredFile(
        String(updated.id),
      );
      await recordCaptureEvent({
        pipelineName: "metadata.refresh",
        pipelineConfig: { pdf: true, url: true },
        captureType: (updated.captureType as any) || "UPLOAD",
        storedFileId: String(updated.id),
        documentRevisionId: docRev.id,
        urlId: updated.urlId ?? null,
        sourceUrl: updated.sourceUrl ?? null,
        actorId: updated.uploaderId ?? null,
        actorName: updated.uploaderName ?? null,
        requestId: (req as any)?.requestId ?? null,
      });
    } catch {}

    return res.json({
      id: updated.id,
      sourcePublishedAt: updated.sourcePublishedAt ?? null,
      sourceAuthors: updated.sourceAuthors ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/revisions?limit=50
// Canonical revision history for the Document that this StoredFile belongs to.
// - Works for uploads and URL snapshots.
// - Will create the Document/DocumentRevision link if missing (repair path).
r.get("/files/:id/revisions", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (id.startsWith("folder:")) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: "Folders do not have revision history.",
        requestId: (req as any)?.requestId ?? null,
      });
    }
    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;

    // Ensure canonical mapping exists so the UI always has history.
    const link = await ensureDocumentRevisionForStoredFile(id);
    const out = await listDocumentRevisions(link.documentId, {
      limit: Number.isFinite(limit) ? (limit as number) : undefined,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/download
r.get("/files/:id/download", async (req, res, next) => {
  try {
    const id = req.params.id;
    const f = await prisma.storedFile.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ message: "Not found" });

    // Fire-and-forget metric
    prisma.storedFile
      .update({ where: { id }, data: { downloads: { increment: 1 } } })
      .catch(() => {});

    await streamFileWithRange({
      req,
      res,
      filePath: f.storagePath,
      fileName: f.fileName,
      contentType: inferMimeType(f.fileName, f.mimeType),
      disposition: "attachment",
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/preview
r.get("/files/:id/preview", async (req, res, next) => {
  try {
    const id = req.params.id;
    const f = await prisma.storedFile.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ message: "Not found" });

    const contentType = inferMimeType(f.fileName, f.mimeType); // may include ; charset=utf-8
    if (!isInlinePreviewable(contentType)) {
      return res
        .status(415)
        .json({ message: "Preview not supported for this file type" });
    }

    await streamFileWithRange({
      req,
      res,
      filePath: f.storagePath,
      fileName: f.fileName,
      contentType,
      disposition: "inline",
    });
  } catch (err) {
    next(err);
  }
});

// HEAD /api/files/:id/preview  (used by pdf.js / probes)
r.head("/files/:id/preview", async (req, res, next) => {
  try {
    const id = req.params.id;
    const f = await prisma.storedFile.findUnique({ where: { id } });
    if (!f) return res.status(404).end();

    const contentType = inferMimeType(f.fileName, f.mimeType);
    if (!isInlinePreviewable(contentType)) return res.status(415).end();

    await streamFileWithRange({
      req,
      res,
      filePath: f.storagePath,
      fileName: f.fileName,
      contentType,
      disposition: "inline",
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/extracted-text
// Returns normalized text for TXT + PDF (PDF is extracted via pdf-parse).
r.get("/files/:id/extracted-text", async (req, res, next) => {
  try {
    const id = req.params.id;
    const maxCharsRaw = req.query.maxChars;
    const maxChars = Math.max(
      1000,
      Math.min(
        2_000_000,
        typeof maxCharsRaw === "string" ? Number(maxCharsRaw) : 200_000,
      ),
    );

    const f = await prisma.storedFile.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ message: "Not found" });
    if (f.deletedAt)
      return res.status(410).json({ message: "File was deleted" });

    const contentType = inferMimeType(f.fileName, f.mimeType);

    let text = "";

    if (
      contentType.includes("pdf") ||
      f.fileName.toLowerCase().endsWith(".pdf")
    ) {
      const buf = fs.readFileSync(f.storagePath);
      const parsed = await pdfParse(buf);
      text = (parsed.text || "").replace(/\r\n/g, "\n");
    } else if (
      contentType.startsWith("text/") ||
      f.fileName.toLowerCase().endsWith(".txt") ||
      f.fileName.toLowerCase().endsWith(".md") ||
      f.fileName.toLowerCase().endsWith(".html")
    ) {
      text = fs.readFileSync(f.storagePath, "utf8");
      text = text.replace(/\r\n/g, "\n");
    } else {
      return res
        .status(415)
        .json({ message: "Text extraction not supported for this file type" });
    }

    const truncated = text.length > maxChars;
    if (truncated) text = text.slice(0, maxChars);

    return res.json({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      captureType: f.captureType,
      sourceUrl: f.sourceUrl,
      urlId: f.urlId,
      sha256: f.sha256,
      truncated,
      text,
    });
  } catch (err) {
    next(err);
  }
});

// FOLDERS
// POST /api/folders - create a folder
r.post("/folders", async (req, res, next) => {
  try {
    const { name, parentId } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Folder name is required" });
    }
    const sanitized = String(name).trim().slice(0, 200);
    if (parentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: String(parentId) },
      });
      if (!parent)
        return res.status(400).json({ message: "Parent folder not found" });
    }
    const folder = await prisma.folder.create({
      data: { name: sanitized, parentId: parentId ? String(parentId) : null },
    });
    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
});

// GET /api/folders - list folders under parent
// Query: parentId (use 'root' or empty for top-level)
r.get("/folders", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }
    const { parentId, includeTrashed } = req.query as Record<string, string>;
    const where: any = {};
    const showTrashed =
      String(includeTrashed || "").toLowerCase() === "true" ||
      String(includeTrashed || "") === "1";
    if (!showTrashed) where.deletedAt = null;

    if (typeof parentId === "string") {
      if (parentId === "root" || parentId === "") where.parentId = null;
      else where.parentId = parentId;
    } else {
      where.parentId = null;
    }
    const folders = await prisma.folder.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        children: {
          where: { deletedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });

    res.json(
      folders.map((f) => {
        const { children, ...rest } = f as any;
        return {
          ...rest,
          hasChildren: Array.isArray(children) && children.length > 0,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

type FolderPathRow = {
  id: string;
  name: string;
  parentId: string | null;
};

type FolderResolveRow = {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt: Date | null;
};

type FolderAncestorRow = {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt: Date | null;
};

r.get("/folders/resolve", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }

    const rawPath = String(
      (req.query as Record<string, string>)?.path || "",
    ).trim();
    if (!rawPath) {
      return res.json({ folderId: null, chain: [] });
    }

    const segments = rawPath
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment, index) => {
        if (index !== 0) return true;
        const rootish = segment.toLowerCase();
        return !["all evidence", "root", "this pc"].includes(rootish);
      });

    if (segments.length === 0) {
      return res.json({ folderId: null, chain: [] });
    }

    let parentId: string | null = null;
    const chain: FolderPathRow[] = [];

    for (const name of segments) {
      const folder: FolderResolveRow | null = await prisma.folder.findFirst({
        where: {
          parentId,
          deletedAt: null,
          name: {
            equals: name,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          deletedAt: true,
        },
        orderBy: { name: "asc" },
      });

      if (!folder) {
        return res.json({ folderId: null, chain: [] });
      }

      chain.push({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      });
      parentId = folder.id;
    }

    return res.json({
      folderId: chain[chain.length - 1]?.id ?? null,
      chain,
    });
  } catch (err) {
    next(err);
  }
});

r.get("/folders/:id/ancestors", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }

    const startId = String(req.params.id);
    let cur: string | null = startId;
    const chain: FolderPathRow[] = [];

    for (let i = 0; i < 200 && cur; i++) {
      const folder: FolderAncestorRow | null = await prisma.folder.findUnique({
        where: { id: cur },
        select: { id: true, name: true, parentId: true, deletedAt: true },
      });

      if (!folder || folder.deletedAt) {
        return res.status(404).json({ message: "Folder not found" });
      }

      chain.push({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      });

      cur = folder.parentId;
    }

    chain.reverse();
    return res.json(chain);
  } catch (err) {
    next(err);
  }
});

// GET /api/folders/:id - get folder info
r.get("/folders/:id", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }
    const id = req.params.id;
    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) return res.status(404).json({ message: "Not found" });
    res.json(folder);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/folders/:id - rename or move
r.patch("/folders/:id", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }
    const id = req.params.id;
    const { name, parentId } = req.body || {};

    const existing = await prisma.folder.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Normalize requested parentId:
    // - undefined => don't change
    // - "root"/""/null => move to root (null)
    // - string => move under that folder
    let desiredParentId: string | null | undefined = undefined;
    if (typeof parentId === "string") {
      desiredParentId =
        parentId === "root" || parentId === "" ? null : String(parentId);
    } else if (parentId === null) {
      desiredParentId = null;
    }

    // If moving, validate parent + prevent cycles (including self-parent)
    if (desiredParentId !== undefined) {
      if (desiredParentId === id) {
        return res.status(400).json({ message: "Invalid move (cycle)" });
      }

      if (desiredParentId) {
        const parent = await prisma.folder.findUnique({
          where: { id: desiredParentId },
          select: { id: true, parentId: true },
        });
        if (!parent) {
          return res.status(400).json({ message: "Parent folder not found" });
        }

        // Cycle check: walk parents until root, bounded to avoid infinite loops
        let cur: string | null = desiredParentId;
        for (let i = 0; i < 200 && cur; i++) {
          if (cur === id) {
            return res.status(400).json({ message: "Invalid move (cycle)" });
          }
          const parentRow: { parentId: string | null } | null =
            await prisma.folder.findUnique({
              where: { id: cur },
              select: { parentId: true },
            });

          cur = parentRow?.parentId ?? null;
        }
      }
    }

    const updated = await prisma.folder.update({
      where: { id },
      data: {
        name:
          typeof name === "string" && name.trim()
            ? String(name).trim().slice(0, 200)
            : existing.name,
        parentId:
          desiredParentId !== undefined ? desiredParentId : existing.parentId,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/folders/:id/trash - soft delete folder + subtree (folders + files)
r.patch("/folders/:id/trash", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }

    const id = req.params.id;
    if (!id || id === "root") {
      return res.status(400).json({ message: "Cannot trash root" });
    }

    const existing = await prisma.folder.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Collect subtree (BFS)
    const allFolderIds: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const fid = queue.shift()!;
      allFolderIds.push(fid);
      const children = await prisma.folder.findMany({
        where: { parentId: fid },
        select: { id: true },
      });
      for (const c of children) queue.push(c.id);
    }

    const now = new Date();

    // Soft-delete folders + files in one transaction
    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: allFolderIds } },
        data: { deletedAt: now },
      }),
      prisma.storedFile.updateMany({
        where: { folderId: { in: allFolderIds } },
        data: { deletedAt: now },
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/folders/:id/restore - restore folder + subtree (folders + files)
r.patch("/folders/:id/restore", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }

    const id = req.params.id;
    if (!id || id === "root") {
      return res.status(400).json({ message: "Cannot restore root" });
    }

    const existing = await prisma.folder.findUnique({
      where: { id },
      select: { id: true, parentId: true, deletedAt: true },
    });
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Safety: if parent is trashed, restoring this folder will keep it "invisible".
    // Force restoring parent first (predictable behavior).
    if (existing.parentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: existing.parentId },
        select: { deletedAt: true },
      });
      if (parent?.deletedAt) {
        return res.status(409).json({
          message:
            "Parent folder is trashed. Restore the parent first (or move to root).",
        });
      }
    }

    // Collect subtree (BFS)
    const allFolderIds: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const fid = queue.shift()!;
      allFolderIds.push(fid);
      const children = await prisma.folder.findMany({
        where: { parentId: fid },
        select: { id: true },
      });
      for (const c of children) queue.push(c.id);
    }

    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: allFolderIds } },
        data: { deletedAt: null },
      }),
      prisma.storedFile.updateMany({
        where: { folderId: { in: allFolderIds } },
        data: { deletedAt: null },
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/files/:id - rename or edit metadata
r.patch("/files/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const { fileName, description, tags, visibility, isFavorited, folderId } =
      req.body || {};
    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    let storagePath = existing.storagePath;
    let nextFileName = existing.fileName;
    let nextMime = existing.mimeType;

    if (
      typeof fileName === "string" &&
      fileName.trim() &&
      fileName.trim() !== existing.fileName
    ) {
      nextFileName = fileName.trim();
      const newPath = finalFilePathFor(id, nextFileName);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      try {
        if (fs.existsSync(existing.storagePath)) {
          fs.renameSync(existing.storagePath, newPath);
        }
        storagePath = newPath;
      } catch (e) {
        return next(e);
      }
      nextMime = inferMimeType(nextFileName, existing.mimeType);
    }

    // Keep favoritesCount consistent with isFavorited
    let nextIsFavorited = existing.isFavorited;
    let nextFavoritesCount = existing.favoritesCount;

    if (
      typeof isFavorited === "boolean" &&
      isFavorited !== existing.isFavorited
    ) {
      nextIsFavorited = isFavorited;
      const delta = isFavorited ? 1 : -1;
      nextFavoritesCount = Math.max(0, existing.favoritesCount + delta);
    }

    const updated = await prisma.storedFile.update({
      where: { id },
      data: {
        fileName: nextFileName,
        storagePath,
        mimeType: nextMime,
        description:
          typeof description === "string" ? description : existing.description,
        tags: Array.isArray(tags) ? tags : existing.tags,
        visibility:
          typeof visibility === "string" ? visibility : existing.visibility,
        favoritesCount: nextFavoritesCount,
        isFavorited: nextIsFavorited,
        folderId:
          typeof folderId === "string"
            ? folderId === "root" || folderId === ""
              ? null
              : folderId
            : existing.folderId,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/files/:id/duplicate - create a copy (optionally into target folder)
r.post("/files/:id/duplicate", async (req, res, next) => {
  try {
    const id = req.params.id;
    const { folderId, fileName } = req.body || {};
    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    const newId = crypto.randomBytes(16).toString("hex");
    const newName =
      typeof fileName === "string" && fileName.trim()
        ? fileName.trim()
        : `${existing.fileName}`;

    const targetFolderId =
      typeof folderId === "string"
        ? folderId === "root" || folderId === ""
          ? null
          : folderId
        : existing.folderId;
    const newPath = finalFilePathFor(newId, newName);
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    // Copy bytes
    if (fs.existsSync(existing.storagePath)) {
      fs.copyFileSync(existing.storagePath, newPath);
    } else {
      return res
        .status(500)
        .json({ message: "Source content missing on disk" });
    }

    const stat = fs.statSync(newPath);
    const record = await prisma.storedFile.create({
      data: {
        id: newId,
        fileName: newName,
        mimeType: inferMimeType(newName, existing.mimeType),
        size: stat.size,
        description: existing.description,
        uploaderId: existing.uploaderId,
        uploaderName: existing.uploaderName,
        storagePath: newPath,
        tags: existing.tags,
        visibility: existing.visibility,
        favoritesCount: 0,
        isFavorited: false,
        folderId: prismaSupportsFolders() ? targetFolderId : undefined,
      } as any,
    });

    // provenance capture event for file duplication ---
    const docRev = await ensureDocumentRevisionForStoredFile(String(record.id));

    await recordCaptureEvent({
      pipelineName: "file.duplicate",
      pipelineConfig: { duplicate: true },
      captureType: "UPLOAD",
      storedFileId: String(record.id),
      documentRevisionId: docRev.id,
      urlId: record.urlId ?? null,
      sourceUrl: record.sourceUrl ?? null,
      actorId: record.uploaderId ?? null,
      actorName: record.uploaderName ?? null,
      requestId: (req as any)?.requestId ?? null,
    });

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/archive/list?prefix=dir1/
r.get("/files/:id/archive/list", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const prefix = normalizeArchivePrefix(String(req.query.prefix || ""));

    if (prefix && !isSafeArchivePath(prefix.slice(0, -1))) {
      return res.status(400).json({ message: "Invalid archive prefix" });
    }

    const chk = await requireZipFileOr400(id);
    if (!chk.ok)
      return res.status(chk.res.status).json({ message: chk.res.message });

    const zipPath = chk.file.storagePath;
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ message: "Archive missing on disk" });
    }

    const index = await getArchiveIndex(zipPath);
    const listing = index.childrenByPrefix.get(prefix) || {
      folders: [],
      files: [],
    };

    return res.json({
      prefix,
      folders: listing.folders,
      files: listing.files,
      truncated: index.truncated,
      indexedAt: index.builtAt,
    });
  } catch (err) {
    next(err);
  }
});

r.get("/files/:id/archive/stream", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const requestedPath = normalizeArchiveEntryPath(
      String(req.query.path || ""),
    );

    if (!requestedPath || !isSafeArchivePath(requestedPath)) {
      return res.status(400).json({ message: "Invalid archive path" });
    }

    const chk = await requireZipFileOr400(id);
    if (!chk.ok)
      return res.status(chk.res.status).json({ message: chk.res.message });

    const zipPath = chk.file.storagePath;
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ message: "Archive missing on disk" });
    }

    const index = await getArchiveIndex(zipPath);
    const meta = index.entryByPath.get(requestedPath);

    if (!meta) {
      return res.status(404).json({ message: "Path not found in archive" });
    }

    if (meta.isDirectory) {
      return res.status(400).json({ message: "Archive path is a directory" });
    }

    if (meta.size > MAX_ARCHIVE_ENTRY_STREAM_BYTES) {
      return res
        .status(413)
        .json({ message: "Archive entry too large to stream" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${path.basename(requestedPath)}"`,
    );

    const zip = await unzipper.Open.file(zipPath);
    const entry = zip.files.find(
      (e: any) =>
        normalizeArchiveEntryPath(String(e.path || "")).replace(/\/+$/, "") ===
        requestedPath,
    );

    if (!entry) {
      return res.status(404).json({ message: "Path not found in archive" });
    }

    entry.stream().on("error", next).pipe(res);
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/archive/search?q=term
r.get("/files/:id/archive/search", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const q = String(req.query.q || "")
      .toLowerCase()
      .trim();

    if (!q) return res.json({ results: [] });

    const chk = await requireZipFileOr400(id);
    if (!chk.ok)
      return res.status(chk.res.status).json({ message: chk.res.message });

    const zipPath = chk.file.storagePath;
    if (!zipPath || !fs.existsSync(zipPath))
      return res.status(404).json({ message: "Archive missing on disk" });

    const index = await getArchiveIndex(zipPath);

    const results: any[] = [];
    let approxBytes = 0;

    for (const entry of index.entries) {
      if (!entry.path.toLowerCase().includes(q)) continue;

      const item = {
        path: entry.path,
        size: entry.size,
        compressedSize: entry.compressedSize,
        isDirectory: entry.isDirectory,
      };

      const nextBytes = approxBytes + JSON.stringify(item).length;
      if (nextBytes > MAX_ARCHIVE_LIST_BYTES) {
        return res.json({
          results,
          truncated: true,
          indexedAt: index.builtAt,
        });
      }

      results.push(item);
      approxBytes = nextBytes;
    }

    return res.json({
      results,
      truncated: index.truncated,
      indexedAt: index.builtAt,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/folders/:id/move
r.post("/folders/:id/move", async (req, res) => {
  const id = String(req.params.id);
  if (!prismaSupportsFolders()) {
    return res.status(501).json({
      message:
        "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
    });
  }
  const { targetFolderId } = req.body || {};
  const existing = await prisma.folder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  if (existing.deletedAt)
    return res.status(409).json({ message: "Folder is in trash" });

  const target =
    typeof targetFolderId === "string"
      ? targetFolderId === "root" || targetFolderId === ""
        ? null
        : String(targetFolderId)
      : null;

  if (target === id)
    return res.status(400).json({ message: "Folder cannot be its own parent" });

  if (target) {
    const parent = await prisma.folder.findUnique({ where: { id: target } });
    if (!parent)
      return res.status(400).json({ message: "Parent folder not found" });
    if (parent.deletedAt)
      return res.status(409).json({ message: "Parent folder is in trash" });

    // cycle check: walk parents until root
    let cur: string | null = target;
    for (let i = 0; i < 100 && cur; i++) {
      if (cur === id)
        return res.status(400).json({ message: "Invalid move (cycle)" });
      const p: typeof existing | null = await prisma.folder.findUnique({
        where: { id: cur },
      });
      cur = p ? (p.parentId as any) : null;
    }
  }

  const updated = await prisma.folder.update({
    where: { id },
    data: { parentId: target },
  });
  return res.json(updated);
});

// DELETE /api/files/:id
// Permanent delete is only allowed for files already in Trash.
r.delete("/files/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    if (!existing.deletedAt) {
      return res.status(409).json({
        code: "FILE_NOT_IN_TRASH",
        message: "Move the file to Trash before deleting it permanently.",
      });
    }

    try {
      if (fs.existsSync(existing.storagePath)) {
        fs.unlinkSync(existing.storagePath);
      }
    } catch {
      // ignore unlink errors; proceed to delete DB row
    }

    await prisma.storedFile.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/files/zip - bulk download selected files as a ZIP
r.post("/files/zip", async (req, res, next) => {
  try {
    const { ids } = (req.body || {}) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ message: "Body must be { ids: string[] }" });
    }

    const files = await prisma.storedFile.findMany({
      where: { id: { in: ids } },
    });
    if (files.length === 0)
      return res.status(404).json({ message: "No files found" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="files.zip"');

    const zipfile = new yazl.ZipFile();
    zipfile.outputStream.on("error", next);
    zipfile.outputStream.pipe(res);

    for (const f of files) {
      if (fs.existsSync(f.storagePath)) {
        zipfile.addFile(f.storagePath, f.fileName);
      }
    }

    zipfile.end();
  } catch (err) {
    next(err);
  }
});

// POST /api/files/:id/move - move a file to another folder
r.post("/files/:id/move", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({ message: "Folders not supported" });
    }

    const id = String(req.params.id);
    const { folderId } = req.body || {};

    // Normalize "root"/""/null → null, otherwise string id
    const targetFolderId =
      typeof folderId === "string"
        ? folderId === "root" || folderId.trim() === ""
          ? null
          : String(folderId)
        : null;

    // Validate target folder if non-root
    if (targetFolderId) {
      const folder = await prisma.folder.findUnique({
        where: { id: targetFolderId },
      });
      if (!folder) {
        return res.status(400).json({ message: "Target folder not found" });
      }
    }

    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "File not found" });

    const updated = await prisma.storedFile.update({
      where: { id },
      data: { folderId: targetFolderId } as any,
    });

    // Keep response compatible (frontend doesn't depend on fields)
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/files/:id/rename
r.put("/files/:id/rename", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { fileName } = req.body || {};
    if (typeof fileName !== "string" || !fileName.trim()) {
      return res.status(400).json({ message: "New file name is required" });
    }

    const sanitized = String(fileName).trim().slice(0, 255);

    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "File not found" });

    let storagePath = existing.storagePath;
    let nextMime = existing.mimeType;

    // If name actually changes, rename on disk and update derived metadata
    if (sanitized !== existing.fileName) {
      const newPath = finalFilePathFor(id, sanitized);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });

      try {
        if (fs.existsSync(existing.storagePath)) {
          fs.renameSync(existing.storagePath, newPath);
        }
        storagePath = newPath;
      } catch (e) {
        return next(e);
      }

      nextMime = inferMimeType(sanitized, existing.mimeType);
    }

    const updated = await prisma.storedFile.update({
      where: { id },
      data: {
        fileName: sanitized,
        storagePath,
        mimeType: nextMime,
      },
    });

    // Keep response shape backward compatible with frontend
    return res.json({ id: updated.id, fileName: updated.fileName });
  } catch (err) {
    next(err);
  }
});

// PUT /api/files/:id/move
r.put("/files/:id/move", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({ message: "Folders not supported" });
    }

    const id = String(req.params.id);
    const { folderId } = req.body || {};

    // Normalize "root"/""/null → null, otherwise string id
    const targetFolderId =
      typeof folderId === "string"
        ? folderId === "root" || folderId.trim() === ""
          ? null
          : String(folderId)
        : null;

    // Validate target folder if non-root
    if (targetFolderId) {
      const folder = await prisma.folder.findUnique({
        where: { id: targetFolderId },
      });
      if (!folder)
        return res.status(400).json({ message: "Target folder not found" });
    }

    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "File not found" });

    const updated = await prisma.storedFile.update({
      where: { id },
      data: { folderId: targetFolderId },
    });

    return res.json({ id: updated.id, folderId: updated.folderId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/folders/:id - recursively delete folder + subtree (folders + files)
// Permanent delete is only allowed for folders already in Trash.
r.delete("/folders/:id", async (req, res, next) => {
  try {
    if (!prismaSupportsFolders()) {
      return res.status(501).json({
        message:
          "Folders not yet available. Please run Prisma migrate/generate and restart the server.",
      });
    }

    const id = req.params.id;
    if (!id || id === "root") {
      return res.status(400).json({ message: "Cannot delete root" });
    }

    const existing = await prisma.folder.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    if (!existing.deletedAt) {
      return res.status(409).json({
        code: "FOLDER_NOT_IN_TRASH",
        message: "Move the folder to Trash before deleting it permanently.",
      });
    }

    // Collect all descendant folders (BFS)
    const allFolderIds: string[] = [];
    const queue: string[] = [id];

    while (queue.length > 0) {
      const fid = queue.shift()!;
      allFolderIds.push(fid);
      const children = await prisma.folder.findMany({
        where: { parentId: fid },
        select: { id: true },
      });
      for (const c of children) queue.push(c.id);
    }

    // Find all files in these folders
    const files = await prisma.storedFile.findMany({
      where: { folderId: { in: allFolderIds } },
      select: { id: true, storagePath: true },
    });

    // Unlink physical files (best-effort)
    for (const f of files) {
      try {
        if (fs.existsSync(f.storagePath)) fs.unlinkSync(f.storagePath);
      } catch {
        // ignore unlink errors, continue
      }
    }

    // Delete DB rows (files first)
    if (files.length) {
      await prisma.storedFile.deleteMany({
        where: { id: { in: files.map((f) => f.id) } },
      });
    }

    // Delete folders bottom-up to avoid FK issues (children → parent)
    for (const fid of allFolderIds.reverse()) {
      await prisma.folder.delete({ where: { id: fid } });
    }

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Tags: list distinct tags across StoredFile with counts ---
// GET /api/tags
r.get("/tags", async (req, res, next) => {
  try {
    // Fetch all tags arrays; aggregate in JS to stay portable
    const rows = await prisma.storedFile.findMany({ select: { tags: true } });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const arr = Array.isArray(r.tags) ? r.tags : [];
      for (const tag of arr) {
        const t = String(tag).trim();
        if (!t) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    const list = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// --- Tags: rename (optionally merge) ---
// PATCH /api/tags/rename
// body: { from: string, to: string, merge?: boolean }
r.patch("/tags/rename", async (req, res, next) => {
  try {
    const { from, to, merge = true } = req.body || {};
    if (!from || !to)
      return res.status(400).json({ error: "from and to are required" });
    const src = String(from).trim();
    const dst = String(to).trim();
    if (!src || !dst)
      return res.status(400).json({ error: "Invalid tag names" });
    if (src === dst) return res.json({ updated: 0, skipped: true });

    // Find affected files first (array-contains equivalent)
    const affected = await prisma.storedFile.findMany({
      where: { tags: { has: src } },
      select: { id: true, tags: true },
    });

    if (!affected.length) return res.json({ updated: 0 });

    // Build updates
    const ops = affected.map((f) => {
      const set = new Set<string>();
      for (const t of f.tags ?? []) {
        if (t === src) {
          if (merge) set.add(dst);
          else set.add(dst); // even without merge, we replace; duplicates removed by Set anyway
        } else {
          set.add(t);
        }
      }
      const nextTags = Array.from(set);
      return prisma.storedFile.update({
        where: { id: f.id },
        data: { tags: nextTags },
      });
    });

    let updated = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const f of affected) {
          const set = new Set<string>();
          for (const t of f.tags ?? []) {
            if (t === src) {
              set.add(dst); // merge=true collapses duplicates automatically via Set
            } else {
              set.add(t);
            }
          }
          const nextTags = Array.from(set);
          await tx.storedFile.update({
            where: { id: f.id },
            data: { tags: nextTags },
          });
          updated += 1;
        }
      },
      { timeout: 60000 },
    );
    res.json({ updated, from: src, to: dst, merge });
  } catch (err) {
    next(err);
  }
});

// --- Tags: delete everywhere ---
// DELETE /api/tags/:tag
r.delete("/tags/:tag", async (req, res, next) => {
  try {
    const tag = String(req.params.tag || "").trim();
    if (!tag) return res.status(400).json({ error: "tag is required" });

    const affected = await prisma.storedFile.findMany({
      where: { tags: { has: tag } },
      select: { id: true, tags: true },
    });
    if (!affected.length) return res.json({ updated: 0 });

    const ops = affected.map((f) => {
      const next = (f.tags ?? []).filter((t) => t !== tag);
      return prisma.storedFile.update({
        where: { id: f.id },
        data: { tags: next },
      });
    });

    let updated = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const f of affected) {
          const next = (f.tags ?? []).filter((t) => t !== tag);
          await tx.storedFile.update({
            where: { id: f.id },
            data: { tags: next },
          });
          updated += 1;
        }
      },
      { timeout: 60000 },
    );
    res.json({ updated, deleted: tag });
  } catch (err) {
    next(err);
  }
});
export default r;
