#!/usr/bin/env sh
set -eu

: "${AURA_DATA_DIR:=/app/backend/data}"

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$AURA_DATA_DIR"
    chown -R aura:aura "$AURA_DATA_DIR"
    exec gosu aura "$0" "$@"
fi

python /usr/local/bin/assert_runtime_permissions.py
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
