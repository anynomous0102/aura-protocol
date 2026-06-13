#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=10000}"
: "${BACKEND_PORT:=8000}"
: "${AURA_DATA_DIR:=/app/backend/data}"

export PORT BACKEND_PORT

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$AURA_DATA_DIR/docs" "$AURA_DATA_DIR/chroma_db" /run/nginx /var/cache/nginx /var/lib/nginx /var/log/nginx /etc/nginx/conf.d
    chown -R aura:aura "$AURA_DATA_DIR" /run/nginx /var/cache/nginx /var/lib/nginx /var/log/nginx /etc/nginx/conf.d
    exec gosu aura "$0" "$@"
fi

mkdir -p "$AURA_DATA_DIR/docs" "$AURA_DATA_DIR/chroma_db"

envsubst '${PORT} ${BACKEND_PORT}' \
    < /etc/nginx/templates/aura.conf.template \
    > /etc/nginx/conf.d/default.conf

uvicorn app.main:app --app-dir /app/backend --host 127.0.0.1 --port "$BACKEND_PORT" &
BACKEND_PID="$!"

nginx -g "pid /run/nginx/nginx.pid; daemon off;" &
NGINX_PID="$!"

term_handler() {
    kill "$NGINX_PID" "$BACKEND_PID" 2>/dev/null || true
    wait "$NGINX_PID" "$BACKEND_PID" 2>/dev/null || true
}

trap term_handler INT TERM

wait -n "$NGINX_PID" "$BACKEND_PID"
EXIT_CODE="$?"
term_handler
exit "$EXIT_CODE"
