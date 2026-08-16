#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${1:-20260816}"
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

# Fetch the requested branch into its remote-tracking ref explicitly.
# This also works when the server repository was originally cloned
# with a single-branch fetch refspec.
git fetch origin \
  "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"

if git show-ref \
  --verify \
  --quiet \
  "refs/heads/${BRANCH}"; then
  git checkout "$BRANCH"
else
  echo "[deploy] local branch does not exist; creating tracking branch: $BRANCH"

  git checkout \
    -b "$BRANCH" \
    --track "origin/$BRANCH"
fi

# Deployment only accepts fast-forward updates.
git merge --ff-only "origin/$BRANCH"

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
