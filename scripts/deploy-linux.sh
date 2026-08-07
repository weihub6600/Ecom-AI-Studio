#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${1:-20260728}"
APP_NAME="${PM2_APP_NAME:-zhe-ai}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[deploy] root: $ROOT_DIR"
echo "[deploy] branch: $BRANCH"
echo "[deploy] pm2 app: $APP_NAME"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "[deploy] tracked files have local changes; aborting to protect them."
  git status --short
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm ci   --registry="$NPM_REGISTRY"   --no-audit   --no-fund   --progress=false

rm -rf web/dist server/dist
npm run build

test -f server/dist/index.js

export PM2_APP_NAME="$APP_NAME"
pm2 startOrReload   ecosystem.config.cjs   --only "$APP_NAME"   --update-env

pm2 save

ENV_PORT=""
if [[ -f .env ]]; then
  ENV_PORT="$(
    grep -E '^PORT=' .env |
      tail -n 1 |
      cut -d= -f2- |
      tr -d '[:space:]' ||
      true
  )"
fi

HEALTH_PORT="${PORT:-${ENV_PORT:-8787}}"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT}/api/health"

for attempt in {1..15}; do
  if curl     --fail     --silent     --show-error     "$HEALTH_URL"     >/dev/null; then
    echo "[deploy] health check passed: $HEALTH_URL"
    pm2 status "$APP_NAME"
    exit 0
  fi

  echo "[deploy] waiting for health check ($attempt/15)..."
  sleep 2
done

echo "[deploy] health check failed: $HEALTH_URL"
pm2 logs "$APP_NAME" --lines 80 --nostream || true
exit 1
