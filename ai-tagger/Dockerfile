# ai-tagger/Dockerfile
FROM python:3.13

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -u 10001 -m appuser
WORKDIR /app

# Dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Code
COPY . /app
RUN chown -R appuser:appuser /app

# Make local modules importable everywhere (uvicorn, celery forks, etc.)
ENV PYTHONPATH=/app

USER appuser
EXPOSE 7071
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7071"]
