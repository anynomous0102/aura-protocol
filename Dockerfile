FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AURA_DATA_DIR=/app/backend/data \
    AURA_ENABLE_ANP_WORKER=false \
    BACKEND_PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        bash \
        ca-certificates \
        curl \
        gettext-base \
        nginx \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.docker.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
COPY docker/nginx.conf.template /etc/nginx/templates/aura.conf.template
COPY docker/start.sh /app/start.sh

RUN chmod +x /app/start.sh \
    && mkdir -p /app/backend/data/docs /app/backend/data/chroma_db /run/nginx \
    && rm -f /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default

EXPOSE 10000

CMD ["/app/start.sh"]
