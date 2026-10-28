# ---- web build -------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- API + SPA -------------------------------------------------------------
FROM python:3.13-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=web /web/dist ./frontend/dist

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/backend/storage/datasets /app/backend/storage/models \
    && chown -R appuser:appuser /app

USER appuser
WORKDIR /app/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

# Run migrations as a separate release step (see docker-compose.yml / docs).
# Starting multiple replicas with migrations in this CMD is unsafe.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
