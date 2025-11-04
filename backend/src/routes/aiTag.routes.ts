import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { createJobFromFile, createJobFromUrl, getJob, healthCheck } from "../services/pyTaggerClient";

const prisma = new PrismaClient();
const r = Router();

const TOPK = Number(process.env.TAGS_TOPK || 6);
const USE_LLM = (process.env.TAGS_USE_LLM || "true").toLowerCase() === "true";

/** Quick health proxy (optional) */
r.get("/tagger/health", async (_req, res, next) => {
  try { res.json(await healthCheck()); } catch (e) { next(e); }
});

/** FILES: start auto-tag job */
r.post("/files/:id/auto-tags", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rec = await prisma.storedFile.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ message: "File not found" });
    if (!rec.storagePath) return res.status(400).json({ message: "Missing storagePath" });

    const { jobId } = await createJobFromFile(rec.storagePath, TOPK, USE_LLM);
    return res.status(202).json({ jobId });
  } catch (e) { next(e); }
});

/** URLS: start auto-tag job */
r.post("/urls/:id/auto-tags", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.url.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ message: "Url not found" });

    const { jobId } = await createJobFromUrl(row.url, TOPK, USE_LLM);
    return res.status(202).json({ jobId });
  } catch (e) { next(e); }
});

/** JOB STATUS: when SUCCESS, persist tags and return payload */
r.get("/tag-jobs/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const fileId = req.query.fileId ? String(req.query.fileId) : null;
    const urlId  = req.query.urlId  ? Number(req.query.urlId)  : null;

    const data = await getJob(jobId);

    // if not done, just return status
    if (data.state !== "SUCCESS") return res.json(data);

    const { tags, hash, tagger_version, phrases, unigrams } = data;

    
if (fileId) {
  const rec = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (rec) {
    const merged = Array.from(new Set([...(rec.tags || []), ...(tags || [])]));
    await prisma.storedFile.update({
      where: { id: fileId },
      data: {
        tags: { set: merged },
        contentHash: hash ?? null,
        taggerVersion: tagger_version ?? null,
        tagsMeta: { phrases: phrases || [], unigrams: unigrams || [] },
      },
    });
  }
}

if (urlId) {
  const row = await prisma.url.findUnique({ where: { id: urlId } });
  if (row) {
    const merged = Array.from(new Set([...(row.tags || []), ...(tags || [])]));
    await prisma.url.update({
      where: { id: urlId },
      data: {
        tags: { set: merged },
        contentHash: hash ?? null,
        taggerVersion: tagger_version ?? null,
        tagsMeta: { phrases: phrases || [], unigrams: unigrams || [] },
      },
    });
  }
}
    return res.json(data);
  } catch (e) { next(e); }
});

export default r;
