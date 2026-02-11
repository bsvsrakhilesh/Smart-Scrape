import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import timeout from "connect-timeout";
import multer from "multer";

import { requestId } from "./middlewares/requestId";
import { log } from "./utils/logger";
import { env } from "./config/env";

import notebookRoutes from "./routes/notebook.routes";
import urlRoutes from "./routes/url.routes";
import searchRoutes from "./routes/search.routes";
import fileRoutes from "./routes/file.routes";
import crawlRoutes from "./routes/crawl.routes";
import aiTagRoutes from "./routes/aiTag.routes";
import chunkRoutes from "./routes/chunk.routes";
import collectionRoutes from "./routes/collection.routes";

dotenv.config();

const app = express();

log.info("startup_config", {
  nodeEnv: process.env.NODE_ENV,
  openaiEnabled: env.OPENAI_ENABLED,
  openaiModel: env.OPENAI_MODEL,
});

// CORS allowlist (production-safe). Set CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
const allowedOrigins = (
  process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// -------- Parsers (single source of truth) --------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.text({ type: ["text/plain", "text/*"], limit: "2mb" }));

// -------- Request ID --------
app.use(requestId);

// -------- Security headers (single helmet config) --------
app.use(
  helmet({
    // CSP is best configured at the frontend/reverse-proxy layer unless you’re strict about it
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

if (process.env.NODE_ENV === "production") {
  app.use(
    helmet.hsts({
      maxAge: 15552000, // 180 days
      includeSubDomains: true,
      preload: true,
    }),
  );
}

// -------- CORS (allowlist + credentials) --------
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (curl/postman) which may send no Origin
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// -------- Timeout --------
app.use(timeout("90s"));

// -------- Access log --------
app.use((req, _res, next) => {
  log.info("http_request", {
    rid: (req as any).requestId,
    method: req.method,
    path: req.originalUrl,
  });
  next();
});

// -------- Rate limits --------
const taggerLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({ windowMs: 60_000, limit: 60 });
const crawlLimiter = rateLimit({ windowMs: 60_000, limit: 30 });
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 30 });

const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "RATE_LIMITED",
    message: "Too many searches. Please wait a minute and try again.",
  },
});

app.use("/api/tagger", taggerLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/crawl", crawlLimiter);
app.use("/api/files", uploadLimiter);

// -------- Routes --------
app.use("/api", urlRoutes);
app.use("/api", collectionRoutes);
app.use("/api/search", searchLimiter, searchRoutes);
app.use("/api", fileRoutes);
app.use("/api", crawlRoutes);
app.use("/api", notebookRoutes);
app.use("/api", chunkRoutes);
app.use("/api", aiTagRoutes);

// ---- Basic root + health endpoints ----
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "SmartScrape backend",
    ping: "/ping",
    apiPing: "/api/ping",
    health: "/health",
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

// -------- Single error handler (deterministic + safe) --------
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;

    const rid = (req as any)?.requestId;

    // Multer size limit => 413
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      log.error("multer_file_too_large", { rid, message: err.message });
      return res
        .status(413)
        .json({ code: "PAYLOAD_TOO_LARGE", message: "File too large" });
    }

    const status: number = Number(err?.status || err?.statusCode || 500);

    if (status === 400) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: err?.message || "Invalid request",
        requestId: rid,
      });
    }

    if (status === 415) {
      return res.status(415).json({
        code: "UNSUPPORTED_MEDIA",
        message: err?.message || "Unsupported media",
        requestId: rid,
      });
    }

    log.error("unhandled_error", {
      rid,
      status,
      message: err?.message,
      stack: err?.stack,
    });

    const isProd = process.env.NODE_ENV === "production";
    return res.status(status).json({
      code: status >= 500 ? "INTERNAL_ERROR" : "ERROR",
      message: err?.message || "Something went wrong",
      requestId: rid,
      ...(isProd ? {} : { stack: err?.stack }),
    });
  },
);

export default app;
