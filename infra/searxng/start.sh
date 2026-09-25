#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PORT:?Render PORT is required}"
: "${SEARXNG_SECRET:?SEARXNG_SECRET is required}"

export SEARXNG_SETTINGS_PATH="$ROOT/settings.yml"
export SEARXNG_BIND_ADDRESS="0.0.0.0"
export SEARXNG_PORT="$PORT"
export SEARXNG_LIMITER="false"
export SEARXNG_PUBLIC_INSTANCE="false"
export GRANIAN_INTERFACE="wsgi"
export GRANIAN_HOST="0.0.0.0"
export GRANIAN_PORT="$PORT"
export GRANIAN_WEBSOCKETS="false"
export GRANIAN_WORKERS="1"
export GRANIAN_BLOCKING_THREADS="4"
export GRANIAN_WORKERS_KILL_TIMEOUT="30s"
export GRANIAN_BLOCKING_THREADS_IDLE_TIMEOUT="5m"

python "$ROOT/smoke.py" &
cd "$ROOT/upstream"
exec granian searx.webapp:app
