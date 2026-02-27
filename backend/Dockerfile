# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN npm install -g npm@latest
# Faster Puppeteer installs & use system Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# System deps for headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates openssl \
    fonts-liberation libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxshmfence1 \
    tesseract-ocr tesseract-ocr-eng poppler-utils \
    wget && \
    rm -rf /var/lib/apt/lists/*

# Copy whichever manifest(s) exist. This will always match at least package.json
COPY package*.json ./

# Install deps (use lock if present, otherwise fallback)
RUN if [ -f package-lock.json ]; then npm ci || (echo "npm ci failed, running npm install" && npm install); else npm install; fi

# ---------- build ----------
FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- production ----------
FROM node:20-bookworm-slim AS prod
WORKDIR /app

# Runtime deps for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates openssl \
    fonts-liberation libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxshmfence1 wget && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV FILE_STORAGE_DIR=/data

# Copy runtime bits
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./


VOLUME ["/data"]
EXPOSE 4000
CMD sh -c "npx prisma migrate deploy && node dist/index.js"
