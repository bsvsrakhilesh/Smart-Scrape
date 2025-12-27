import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { requestId } from './middlewares/requestId';
import { log } from './utils/logger';
import rateLimit from 'express-rate-limit';
import timeout from 'connect-timeout';
import multer from 'multer';

dotenv.config();

import notebookRoutes from './routes/notebook.routes';
import urlRoutes from './routes/url.routes';
import searchRoutes from './routes/search.routes';
import fileRoutes from './routes/file.routes';
import crawlRoutes from './routes/crawl.routes';
import aiTagRoutes from "./routes/aiTag.routes";
import chunkRoutes from './routes/chunk.routes';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.text({ type: ['text/plain', 'text/*'], limit: '2mb' })); 

app.use(requestId);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));

// simple access log (uses existing logger util)
app.use((req, _res, next) => {
  log.info('http_request', {
    rid: (req as any).requestId,
    method: req.method,
    path: req.originalUrl,
  });
  next();
});

const taggerLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,          // tweak as needed
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/tagger', taggerLimiter);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'"], "object-src": ["'none'"],
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: true }));
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(timeout('90s'));

// Route-specific rate limits
const authLimiter   = rateLimit({ windowMs: 60_000, limit: 60 });
const crawlLimiter  = rateLimit({ windowMs: 60_000, limit: 30 });
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 30 });

const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many searches. Please wait a minute and try again.' },
});

app.use('/api/auth',   authLimiter);
app.use('/api/crawl',  crawlLimiter);
app.use('/api/files',  uploadLimiter);

app.use('/api', urlRoutes);
app.use('/api/search', searchLimiter, searchRoutes);
app.use('/api', fileRoutes);
app.use('/api', crawlRoutes);
app.use('/api', notebookRoutes);
app.use('/api', chunkRoutes);
app.use("/api", aiTagRoutes);

// ---- Basic root + health endpoints (fix "Cannot GET /") ----
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "SmartScrape backend",
    ping: "/ping",
    apiPing: "/api/ping",
    health: "/health",
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
// ---- end ----

app.get('/ping', (_req, res) => res.send('pong'));

app.use((err: any, req: any, res: any, _next: any) => {
  const status = err.status || 500;
  const requestId = req?.requestId;
  log.error('unhandled_error', { requestId, status, message: err?.message, stack: err?.stack });

  res.status(status).json({
    message: err?.message || 'Server error',
    requestId,
  });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return; // prevent "Cannot set headers after they are sent"
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Chunk too large' });
  }
  if (err.status === 400) return res.status(400).json({ code: 'BAD_REQUEST', message: err.message || 'Invalid request' });
  if (err.status === 415) return res.status(415).json({ code: 'UNSUPPORTED_MEDIA', message: err.message || 'Unsupported media' });
  console.error('Unhandled error', err);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
});


export default app;
