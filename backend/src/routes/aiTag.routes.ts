import { Router } from "express";
import prisma from "../config/database";
import {
  createJobFromFile,
  createJobFromUrl,
  getJob,
  healthCheck,
} from "../services/pyTaggerClient";
import {
  getAiTaggingUnavailableMessage,
  getFileCapability,
} from "../utils/fileCapabilities";

const r = Router();

const TOPK = Number(process.env.TAGS_TOPK || 10);
const USE_LLM = (process.env.TAGS_USE_LLM || "false").toLowerCase() === "true";

/** Quick health proxy (optional) */
r.get("/tagger/health", async (_req, res, next) => {
  try {
    res.json(await healthCheck());
  } catch (e) {
    next(e);
  }
});

/** FILES: start auto-tag job */
r.post("/files/:id/auto-tags", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rec = await prisma.storedFile.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ message: "File not found" });
    if (!rec.storagePath)
      return res.status(400).json({ message: "Missing storagePath" });

    const capability = getFileCapability(rec.fileName, rec.mimeType);
    if (!capability.aiTagSupported) {
      const msg = getAiTaggingUnavailableMessage(rec.fileName, rec.mimeType);

      await prisma.storedFile.update({
        where: { id },
        data: {
          taggingStatus: "NONE",
          taggingJobId: null,
          taggingError: msg,
        },
      });

      return res.status(409).json({
        code: "AI_TAGGING_UNSUPPORTED",
        message: msg,
      });
    }

    const { jobId } = await createJobFromFile(rec.storagePath, TOPK, USE_LLM);

    await prisma.storedFile.update({
      where: { id },
      data: {
        taggingStatus: "RUNNING",
        taggingJobId: jobId,
        taggingError: null,
      },
    });

    return res.status(202).json({ jobId });
  } catch (e) {
    next(e);
  }
});

r.post("/urls/:id/auto-tags", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.url.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ message: "Url not found" });

    const latestSnap = await prisma.storedFile.findFirst({
      where: { urlId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { storagePath: true },
    });

    const { jobId } = latestSnap?.storagePath
      ? await createJobFromFile(latestSnap.storagePath, TOPK, USE_LLM)
      : await createJobFromUrl(row.url, TOPK, USE_LLM);

    await prisma.url.update({
      where: { id },
      data: {
        taggingStatus: "RUNNING",
        taggingJobId: jobId,
        taggingError: null,
      },
    });

    return res.status(202).json({
      jobId,
      source: latestSnap?.storagePath ? "snapshot" : "live-url",
    });
  } catch (e) {
    next(e);
  }
});

/** JOB STATUS: when SUCCESS, persist tags and return payload */
r.get("/tag-jobs/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const fileId = req.query.fileId ? String(req.query.fileId) : null;
    const urlId = req.query.urlId ? Number(req.query.urlId) : null;

    const data = await getJob(jobId);

    if (data.state !== "SUCCESS") {
      if (fileId && data.state === "FAILURE") {
        const msg = String(
          data?.error || data?.message || "Unknown ai-tagger failure",
        ).slice(0, 500);

        await prisma.storedFile.update({
          where: { id: fileId },
          data: {
            taggingStatus: "FAILED",
            taggingJobId: null,
            taggingError: msg,
          },
        });
      }

      if (urlId && data.state === "FAILURE") {
        const msg = String(
          data?.error || data?.message || "Unknown ai-tagger failure",
        ).slice(0, 500);
        await prisma.url.update({
          where: { id: urlId },
          data: {
            taggingStatus: "FAILED",
            taggingJobId: null,
            taggingError: msg,
          },
        });
      }

      return res.json(data);
    }

    const {
      tags,
      hash,
      tagger_version,
      phrases,
      unigrams,
      structured,
      extraction,
    } = data;

    const buildNextTagsMeta = (prev: any) => {
      const p = prev && typeof prev === "object" ? prev : {};
      const prevTagger =
        p.tagger && typeof p.tagger === "object" ? p.tagger : {};

      return {
        ...p,
        tagger: {
          ...prevTagger,
          phrases: phrases || [],
          unigrams: unigrams || [],
          topk: TOPK,
          use_llm: USE_LLM,
          jobId,
          updatedAt: new Date().toISOString(),
          structured: structured || null,
          extraction: extraction || null,
        },
      };
    };

    if (fileId) {
      const rec = await prisma.storedFile.findUnique({ where: { id: fileId } });
      if (rec) {
        const merged = Array.from(
          new Set([...(rec.tags || []), ...(tags || [])]),
        );

        await prisma.storedFile.update({
          where: { id: fileId },
          data: {
            tags: { set: merged },
            contentHash: hash ?? null,
            taggerVersion: tagger_version ?? null,
            tagsMeta: buildNextTagsMeta(rec.tagsMeta),
            taggingStatus: "SUCCESS",
            taggingJobId: null,
            taggingError: null,
          },
        });
      }
    }

    if (urlId) {
      const row = await prisma.url.findUnique({ where: { id: urlId } });
      if (row) {
        const merged = Array.from(
          new Set([...(row.tags || []), ...(tags || [])]),
        );

        await prisma.url.update({
          where: { id: urlId },
          data: {
            tags: { set: merged },
            contentHash: hash ?? null,
            taggerVersion: tagger_version ?? null,
            tagsMeta: buildNextTagsMeta(row.tagsMeta),
            taggingStatus: "SUCCESS",
            taggingJobId: null,
            taggingError: null,
          },
        });
      }
    }

    return res.json(data);
  } catch (e) {
    next(e);
  }
});

export default r;
