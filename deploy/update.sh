#!/usr/bin/env bash
# Pull the latest code from GitHub and restart the sign's app if anything changed.
# Run on the sign:  ./deploy/update.sh
# Per-sign files (data/, certs/, public/images/, public/css/site.css) are not in
# git, so a pull never touches tenants, passwords, photos or site styling.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-building-directory}"

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date ($(git log -1 --format='%h %s'))"
  exit 0
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Local edits to tracked files on this sign; not updating:" >&2
  git status --short --untracked-files=no >&2
  echo "Move per-sign styling into public/css/site.css, or run: git stash" >&2
  exit 1
fi

OLD_LOCK=$(git rev-parse HEAD:package-lock.json)
git merge --ff-only --quiet "origin/$BRANCH"
NEW_LOCK=$(git rev-parse HEAD:package-lock.json)

if [ "$OLD_LOCK" != "$NEW_LOCK" ] || [ ! -d node_modules ]; then
  echo "Dependencies changed; installing..."
  npm ci --omit=dev
fi

echo "Updated ${LOCAL:0:7} -> $(git log -1 --format='%h %s')"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" && echo "$SERVICE restarted OK" || {
  echo "$SERVICE failed to start; recent log:" >&2
  journalctl -u "$SERVICE" -n 30 --no-pager >&2
  exit 1
}
