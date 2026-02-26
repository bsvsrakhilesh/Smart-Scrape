# ai-tagger/Dockerfile
# Use 3.12 for best compatibility with spaCy + common ML libs
FROM python:3.12-slim

# ---- Runtime env (less noise, better logs) ----
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 

# ---- OS deps ----
# build-essential: for packages that need compilation
# poppler-utils: pdf2image backend (pdftoppm)
# tesseract-ocr: OCR backend (pytesseract)
# curl: for HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    tesseract-ocr \
    curl \
 && rm -rf /var/lib/apt/lists/*

# ---- Create non-root user ----
RUN useradd -u 10001 -m appuser

WORKDIR /app

# ---- Virtual environment (keeps installs clean & predictable) ----
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ---- Dependencies first (better layer caching) ----
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# ---- spaCy model (required for noun_chunks + NER) ----
RUN python -m spacy download en_core_web_sm

# ---- App code ----
COPY . /app
RUN chown -R appuser:appuser /app

# Make local modules importable everywhere (uvicorn, celery forks, etc.)
ENV PYTHONPATH=/app

USER appuser

EXPOSE 7071

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7071"]
