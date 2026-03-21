import { Request, Response, NextFunction } from "express";
import {
  getSourceChunk,
  getChunkReader,
  getSourcePage,
} from "../services/notebook.service";

const firstParam = (v: unknown): string =>
  Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");

export async function getChunkHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const chunk = await getSourceChunk(firstParam(req.params.id));
    if (!chunk) return res.status(404).json({ message: "Chunk not found" });

    res.json({
      id: chunk.id,
      sourceId: chunk.sourceId,
      idx: chunk.idx,
      text: chunk.text,
      source: chunk.source, // includes url/file
    });
  } catch (e) {
    next(e);
  }
}

export async function getChunkReaderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const radius = Number(req.query.radius ?? 3);
    const data = await getChunkReader(firstParam(req.params.id), radius);
    if (!data) return res.status(404).json({ message: "Chunk not found" });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getSourcePageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const sourceId = firstParam(req.params.sourceId);
    const pageNumber = firstParam(req.params.pageNumber);
    const pn = Number(pageNumber);
    if (!Number.isFinite(pn) || pn < 1)
      return res.status(400).json({ message: "Invalid pageNumber" });

    const page = await getSourcePage(sourceId, pn);
    if (!page) return res.status(404).json({ message: "Page not found" });

    res.json(page);
  } catch (e) {
    next(e);
  }
}
