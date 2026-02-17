import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import prisma from "../config/database";
import { ensureDocumentRevisionForStoredFile } from "../services/document.service";
import { recordCaptureEvent } from "../services/provenance.service";
import yazl from "yazl";
import crypto from "crypto";
import unzipper from "unzipper";
import pdfParse from "pdf-parse";

// ===== Upload hardening =====
const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024, // 50MB default
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
  // If we already have a specific type (not generic), use it
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return fallback || "application/octet-stream";
  }
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

function prismaSupportsFolders(): boolean {
  // When Prisma client hasn't been regenerated, `prisma.folder` may be undefined
  return typeof (prisma as any).folder?.findMany === "function";
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

        // 2) Then validate magic bytes on the stitched file
        const { fileTypeFromFile } = await import("file-type");
        const ft = await fileTypeFromFile(finalPath);

        const okExt = /\.(pdf|png|jpe?g|webp|gif|svg)$/i.test(safeFileName);
        const okMime =
          ft &&
          /^(application\/pdf|image\/(png|jpeg|webp|gif|svg\+xml))$/.test(
            ft.mime,
          );

        if (!okExt || !okMime) {
          try {
            fs.unlinkSync(finalPath);
          } catch {}
          // cleanup chunk dir
          for (let i = 0; i < total; i++) {
            try {
              fs.unlinkSync(path.join(dir, `${i}.part`));
            } catch {}
          }
          try {
            fs.rmdirSync(dir);
          } catch {}
          return res.status(415).json({
            code: "UNSUPPORTED_MEDIA",
            message: "Unsupported file type",
          });
        }

        // 3) Cleanup chunks on success
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
          mimeType: inferMimeType(
            safeFileName,
            req.file?.mimetype || "application/octet-stream",
          ),
          size: stat.size,
          uploaderId: "self",
          uploaderName: "You",
          storagePath: finalPath,
          sha256,
          contentHash: sha256,
        };
        const createData: any = {
          id: safeFingerprint,
          fileName: safeFileName,
          mimeType: updateData.mimeType,
          size: stat.size,
          uploaderId: updateData.uploaderId,
          uploaderName: updateData.uploaderName,
          storagePath: finalPath,
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

        // Kick async tagging via Python ai-tagger (does not block API)
        try {
          const { scheduleAiTagForFile } =
            await import("../services/aiTagAuto.service");
          scheduleAiTagForFile(String(rec.id));
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

// PATCH /api/files/:id/trash  → soft delete
r.patch("/files/:id/trash", async (req, res) => {
  const id = String(req.params.id);

  // Optional: prevent double-delete
  const existing = await prisma.storedFile.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
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

    const hasPagination =
      Number.isInteger(Number(page)) && Number.isInteger(Number(pageSize));

    if (hasPagination) {
      const p = Math.max(1, Number(page));
      const ps = Math.min(100, Math.max(1, Number(pageSize)));
      const skip = (p - 1) * ps;

      const [files, total, sum] = await Promise.all([
        prisma.storedFile.findMany({ where, orderBy, skip, take: ps }),
        prisma.storedFile.count({ where }),
        prisma.storedFile.aggregate({ where, _sum: { size: true } }),
      ]);

      const totalBytes = sum?._sum?.size ?? 0;
      return res.json({
        files,
        folders,
        total,
        totalBytes,
        page: p,
        pageSize: ps,
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

    const safeFileName = sanitizeFilename(fileName);

    const dir = chunkDirFor(fingerprint);
    if (!fs.existsSync(dir))
      return res.status(400).json({ message: "No chunks found to finalize" });

    const partFiles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".part"))
      .sort(
        (a, b) => Number(a.split(".part")[0]) - Number(b.split(".part")[0]),
      );

    const finalPath = finalFilePathFor(fingerprint, safeFileName);
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

    const sha256 = await sha256File(finalPath);

    const updateData: any = {
      fileName: safeFileName,
      mimeType: inferMimeType(
        safeFileName,
        mimeType || "application/octet-stream",
      ),
      size: stat.size,
      description,
      uploaderId,
      uploaderName,
      storagePath: finalPath,
      sha256,
      contentHash: sha256,
    };
    const createData: any = {
      id: fingerprint,
      fileName: safeFileName,
      mimeType: inferMimeType(
        safeFileName,
        mimeType || "application/octet-stream",
      ),
      size: stat.size,
      description,
      uploaderId,
      uploaderName,
      storagePath: finalPath,
      sha256,
      contentHash: sha256,
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

    // Kick async tagging via Python ai-tagger (does not block API)
    try {
      const { scheduleAiTagForFile } =
        await import("../services/aiTagAuto.service");
      scheduleAiTagForFile(String(record.id));
    } catch (e) {
      console.error("aiTagAuto import failed", e);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/files
// Supports optional filtering and pagination
// Query: q, tags (csv), mimeTypes (csv), visibility, favoritesOnly, sortKey (createdAt|fileName|size), sortOrder (asc|desc), page, pageSize, folderId
r.get("/files", async (req, res, next) => {
  try {
    const {
      q,
      tags,
      mimeTypes,
      visibility,
      favoritesOnly,
      sortKey = "createdAt",
      sortOrder = "desc",
      page,
      pageSize,
      folderId,
    } = req.query as Record<string, string>;

    const where: any = {
      deletedAt: null,
    };
    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      where.OR = [
        { fileName: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ];
    }
    if (tags) {
      const arr = String(tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (arr.length) where.tags = { hasEvery: arr };
    }
    if (mimeTypes) {
      const arr = String(mimeTypes)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (arr.length) where.mimeType = { in: arr };
    }
    if (visibility && (visibility === "public" || visibility === "private")) {
      where.visibility = visibility;
    }
    if (favoritesOnly === "true") {
      where.isFavorited = true;
    }

    if (typeof folderId === "string" && prismaSupportsFolders()) {
      if (folderId === "root" || folderId === "") where.folderId = null;
      else where.folderId = folderId;
    }

    const orderBy: any = {};
    if (["createdAt", "fileName", "size"].includes(String(sortKey))) {
      orderBy[String(sortKey)] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const hasPagination =
      Number.isInteger(Number(page)) && Number.isInteger(Number(pageSize));
    if (hasPagination) {
      const p = Math.max(1, Number(page));
      const ps = Math.min(100, Math.max(1, Number(pageSize)));
      const skip = (p - 1) * ps;
      try {
        const [items, total, sum] = await Promise.all([
          prisma.storedFile.findMany({ where, orderBy, skip, take: ps }),
          prisma.storedFile.count({ where }),
          prisma.storedFile.aggregate({ where, _sum: { size: true } }),
        ]);

        const totalBytes = sum?._sum?.size ?? 0;
        return res.json({ items, total, totalBytes, page: p, pageSize: ps });
      } catch (e: any) {
        // Fallback when older Prisma client doesn't know folderId
        if (String(e?.message || "").includes("Unknown argument `folderId`")) {
          const { folderId: _omit, ...whereNoFolder } = where;
          const [items, total, sum] = await Promise.all([
            prisma.storedFile.findMany({
              where: whereNoFolder,
              orderBy,
              skip,
              take: ps,
            }),
            prisma.storedFile.count({ where: whereNoFolder }),
            prisma.storedFile.aggregate({
              where: whereNoFolder,
              _sum: { size: true },
            }),
          ]);

          const totalBytes = sum?._sum?.size ?? 0;
          return res.json({ items, total, totalBytes, page: p, pageSize: ps });
        }
        throw e;
      }
    }

    try {
      const files = await prisma.storedFile.findMany({ where, orderBy });
      res.json(files);
    } catch (e: any) {
      if (String(e?.message || "").includes("Unknown argument `folderId`")) {
        const { folderId: _omit, ...whereNoFolder } = where;
        const files = await prisma.storedFile.findMany({
          where: whereNoFolder,
          orderBy,
        });
        return res.json(files);
      }
      throw e;
    }
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

    return res.json({
      usedBytes: agg._sum.size ?? 0,
      fileCount: agg._count._all ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id
r.get("/files/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const f = await prisma.storedFile.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ message: "Not found" });
    
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
      sha256: f.sha256 ?? null,
      contentHash: f.contentHash ?? null,
      taggerVersion: f.taggerVersion ?? null,
      tagsMeta: f.tagsMeta ?? null,
    });
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
    });
    res.json(folders);
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
r.get("/files/:id/archive/list", async (req, res) => {
  const id = String(req.params.id);
  const prefix = String(req.query.prefix || "");
  const f = await prisma.storedFile.findUnique({ where: { id } });
  if (!f || !f.storagePath || !f.fileName.toLowerCase().endsWith(".zip"))
    return res.status(404).json({ message: "Not a zip" });

  const s = fs
    .createReadStream(f.storagePath)
    .on("error", (err) =>
      res.status(500).json({ message: "Read error", error: String(err) }),
    )
    .pipe(unzipper.Parse({ forceStream: true }))
    .on("error", (err: any) =>
      res.status(500).json({ message: "Zip parse error", error: String(err) }),
    );
  const dirs = new Set<string>();
  const files: any[] = [];
  s.on("entry", (entry: any) => {
    const p = String(entry.path).replace(/\\/g, "/");
    if (!p.startsWith(prefix)) {
      entry.autodrain();
      return;
    }
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      dirs.add(rest.slice(0, slash));
      entry.autodrain();
    } else {
      files.push({
        name: rest,
        size: entry.vars.uncompressedSize,
        modified: entry.vars.lastModifiedDate,
      });
      entry.autodrain();
    }
  });
  s.on("close", () => res.json({ prefix, folders: [...dirs], files }));
});

r.get("/files/:id/archive/stream", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const p = String(req.query.path || "");

    if (!isSafeArchivePath(p)) {
      return res.status(400).json({ message: "Invalid archive path" });
    }

    const chk = await requireZipFileOr400(id);
    if (!chk.ok)
      return res.status(chk.res.status).json({ message: chk.res.message });

    const zipPath = chk.file.storagePath;
    if (!fs.existsSync(zipPath))
      return res.status(404).json({ message: "Archive missing on disk" });

    const stream = fs.createReadStream(zipPath);
    const zip = await unzipper.Open.stream(stream);

    // Find entry safely, cap work
    let scanned = 0;
    const entry = zip.files.find((e: any) => {
      scanned++;
      return scanned <= MAX_ARCHIVE_ENTRIES_SCAN && e.path === p;
    });

    if (!entry)
      return res.status(404).json({ message: "Path not found in archive" });

    // Cap streaming size (uncompressed)
    const size = Number(entry.uncompressedSize || 0);
    if (size > MAX_ARCHIVE_ENTRY_STREAM_BYTES) {
      return res
        .status(413)
        .json({ message: "Archive entry too large to stream" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${path.basename(p)}"`,
    );

    // Stream entry
    entry.stream().pipe(res);
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
    if (!fs.existsSync(zipPath))
      return res.status(404).json({ message: "Archive missing on disk" });

    const stream = fs.createReadStream(zipPath);
    const zip = await unzipper.Open.stream(stream);

    const results: any[] = [];
    let scanned = 0;
    let approxBytes = 0;

    for (const e of zip.files) {
      scanned++;
      if (scanned > MAX_ARCHIVE_ENTRIES_SCAN) break;

      const ep = String(e.path || "");
      if (!ep) continue;
      if (!isSafeArchivePath(ep)) continue;

      if (ep.toLowerCase().includes(q)) {
        const item = {
          path: ep,
          size: Number(e.uncompressedSize || 0),
          compressedSize: Number((e as any).compressedSize || 0),
          isDirectory: !!e.type && String(e.type).toLowerCase() === "directory",
        };
        results.push(item);
        approxBytes += JSON.stringify(item).length;
        if (approxBytes > MAX_ARCHIVE_LIST_BYTES) break;
      }
    }

    return res.json({
      results,
      truncated:
        scanned > MAX_ARCHIVE_ENTRIES_SCAN ||
        approxBytes > MAX_ARCHIVE_LIST_BYTES,
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
r.delete("/files/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const existing = await prisma.storedFile.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });

    try {
      if (fs.existsSync(existing.storagePath)) {
        fs.unlinkSync(existing.storagePath);
      }
    } catch (e) {
      // ignore unlink errors; proceed to delete DB row
    }

    await prisma.storedFile.delete({ where: { id } });
    res.status(204).send();
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
