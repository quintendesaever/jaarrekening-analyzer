# --- Frontend build ---
FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Backend API ---
FROM python:3.12-slim-bookworm AS backend
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/config ./config
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown -R app:app /app /data \
    && chmod 755 /docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# --- Reverse proxy + static SPA ---
FROM caddy:2-alpine AS caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /frontend/dist /srv
