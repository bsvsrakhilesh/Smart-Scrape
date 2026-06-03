# syntax=docker/dockerfile:1.7
# ai-tagger/Dockerfile
# Use 3.12 for best compatibility with spaCy + common ML libs
FROM python:3.12-slim

# ---- Runtime env (less noise, better logs) ----
# ML dependency index pages and wheels can take longer through Docker proxies.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

# ---- OS deps ----
# build-essential: for packages that need compilation
# poppler-utils: pdf2image fallback backend (pdftoppm)
# OCRmyPDF stack: primary scanned-PDF OCR path
# tesseract-ocr: image/fallback OCR backend
# curl: for HEALTHCHECK
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ghostscript \
    ocrmypdf \
    poppler-utils \
    qpdf \
    unpaper \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    curl

# ---- Create non-root user ----
RUN useradd -u 10001 -m appuser

WORKDIR /app

# ---- Virtual environment (keeps installs clean & predictable) ----
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ---- Dependencies first (better layer caching) ----
COPY requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
 && pip install -r /app/requirements.txt

# ---- spaCy model (required for noun_chunks + NER) ----
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m spacy download en_core_web_sm

# ---- App code ----
COPY . /app
RUN chown -R appuser:appuser /app

# Make local modules importable everywhere (uvicorn, celery forks, etc.)
ENV PYTHONPATH=/app

USER appuser

EXPOSE 7071
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7071/health >/dev/null || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7071", "--no-access-log"]
