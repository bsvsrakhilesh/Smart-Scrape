import { Request, Response, NextFunction } from 'express';
import { getSourceChunk } from '../services/notebook.service';

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
