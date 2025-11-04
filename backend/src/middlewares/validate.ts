import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

export const validate =
  (schema: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema }) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // Body can be safely replaced
      if (schema.body) {
        const parsedBody = schema.body.parse(req.body);
        (req as any).body = parsedBody;
      }

      // For query/params on Express 5: validate only, don't overwrite
      // Optionally stash parsed versions for controllers that want them:
      const parsed: Record<string, unknown> = {};

      if (schema.query) {
        parsed.query = schema.query.parse(req.query);
      }
      if (schema.params) {
        parsed.params = schema.params.parse(req.params);
      }

      if (Object.keys(parsed).length) {
        // Put validated structs somewhere safe for handlers to read if they want
        res.locals.validated = { ...(res.locals.validated || {}), ...parsed };
      }

      next();
    } catch (e: any) {
      e.status = 400;
      next(e);
    }
  };
