# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci || (echo "npm ci failed; package-lock.json may be out of sync. Running npm install inside the image." && npm install); else npm install; fi
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Build the static app
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci || (echo "npm ci failed; package-lock.json may be out of sync. Running npm install inside the image." && npm install); else npm install; fi
COPY . .
# Let API URL be configurable at build time (optional)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Serve via Nginx with SPA fallback + proxy to backend
FROM nginx:1.27-alpine AS prod
WORKDIR /usr/share/nginx/html
COPY --from=build /app/dist/ ./
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
