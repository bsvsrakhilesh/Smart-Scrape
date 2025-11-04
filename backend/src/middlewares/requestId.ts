import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header('X-Request-Id') || randomUUID();
  (req as any).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
