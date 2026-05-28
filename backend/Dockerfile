# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Faster Puppeteer installs & use system Chromium
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# System deps for headless Chromium
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates openssl \
    fonts-liberation libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxshmfence1 \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin \
    poppler-utils ocrmypdf ghostscript qpdf unpaper \
    wget

# Copy whichever manifest(s) exist. This will always match at least package.json
COPY package*.json ./

# Install deps (use lock if present, otherwise fallback)
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci || (echo "npm ci failed, running npm install" && npm install); else npm install; fi

# Generate Prisma client inside the image so clean clones do not depend on
# untracked src/generated output from a developer machine.
ARG DATABASE_URL="postgresql://postgres:postgres@localhost:5432/SmartScrape?schema=public"
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="$DATABASE_URL" npx prisma generate

# ---------- build ----------
FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- production ----------
FROM node:22-bookworm-slim AS prod
WORKDIR /app

# Runtime deps for Chromium
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates openssl \
    fonts-liberation libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxshmfence1 \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin \
    poppler-utils ocrmypdf ghostscript qpdf unpaper wget

ENV NODE_ENV=production
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV FILE_STORAGE_DIR=/data

# Copy runtime bits
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/prisma.config.ts ./
COPY package*.json ./

RUN mkdir -p /data && chown -R node:node /app /data

VOLUME ["/data"]
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
