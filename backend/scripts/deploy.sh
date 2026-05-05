#!/bin/sh
# Deploy the backend to Fly.io.
#
# Safe to invoke from any cwd inside the repo: it resolves the repo
# root via `git rev-parse` and `cd`s into `backend/` (where fly.toml +
# Dockerfile live) before running `fly deploy`. Extra args are passed
# through, e.g. `npm run deploy:backend -- --remote-only`.
set -eu

if ! command -v fly >/dev/null 2>&1 && ! command -v flyctl >/dev/null 2>&1; then
    echo "fly CLI not found on PATH. Install: https://fly.io/docs/flyctl/install/" >&2
    exit 127
fi

FLY_BIN="$(command -v fly || command -v flyctl)"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/backend"

exec "$FLY_BIN" deploy "$@"
