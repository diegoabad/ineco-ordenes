#!/bin/sh
set -e

required_vars="
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
"

for var in $required_vars; do
  eval "value=\$$var"
  if [ -z "$value" ]; then
    echo "$var is required at runtime (set in server .env / docker compose, not in VITE_*)" >&2
    exit 1
  fi
done

export PORT="${PORT:-3000}"
export UPLOADS_DIR="${UPLOADS_DIR:-uploads/firmas}"

mkdir -p /app/api/uploads/firmas

cd /app/api
node dist/index.js &
exec nginx -g "daemon off;"
