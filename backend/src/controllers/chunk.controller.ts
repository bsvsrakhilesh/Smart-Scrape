import { Request, Response, NextFunction } from 'express';
import { getSourceChunk, getChunkReader } from '../services/notebook.service';

export async function getChunkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const chunk = await getSourceChunk(req.params.id);
    if (!chunk) return res.status(404).json({ message: 'Chunk not found' });

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

export async function getChunkReaderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const radius = Number(req.query.radius ?? 3);
    const data = await getChunkReader(req.params.id, radius);
    if (!data) return res.status(404).json({ message: 'Chunk not found' });
    res.json(data);
  } catch (e) {
    next(e);
  }
}
