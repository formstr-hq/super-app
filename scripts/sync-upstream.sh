#!/usr/bin/env bash
# Clone or update read-only reference clones of formstr-hq modules.
# Idempotent: safe to run repeatedly.
set -euo pipefail

REPOS=(
  "nostr-forms"
  "nostr-calendar"
  "nostr-polls"
  "nostr-docs"
  "formstr-drive"
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_DIR="$ROOT/upstream"
mkdir -p "$UPSTREAM_DIR"

for repo in "${REPOS[@]}"; do
  TARGET="$UPSTREAM_DIR/$repo"
  if [ -d "$TARGET/.git" ]; then
    echo "==> Updating $repo"
    git -C "$TARGET" fetch --depth=1 origin
    DEFAULT_BRANCH="$(git -C "$TARGET" symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')"
    git -C "$TARGET" reset --hard "origin/$DEFAULT_BRANCH"
  else
    echo "==> Cloning $repo"
    git clone --depth=1 "https://github.com/formstr-hq/$repo.git" "$TARGET"
  fi
  echo "    $(git -C "$TARGET" log -1 --oneline)"
done

echo
echo "Done. upstream/ contains:"
ls -1 "$UPSTREAM_DIR"
