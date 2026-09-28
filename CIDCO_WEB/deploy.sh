#!/usr/bin/env bash
#
# Pull, build, reload. The whole deploy.
#
#   ./deploy.sh
#
# Safe to run as often as you like: it reloads the processes named in
# ecosystem.config.js rather than starting new ones, so `pm2 ls` shows the same
# three however many times this has run.
#
# Skip the build when only the poll interval or another .env value changed:
#
#   ./deploy.sh --no-build
#
set -euo pipefail

cd "$(dirname "$0")"

BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

say "Pulling"
git pull --ff-only origin main

say "Installing dependencies"
# `npm ci` when the lockfile is authoritative — it is faster and cannot drift
# from what was tested. Falls back to install if there is no lockfile yet.
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi

say "Applying migrations"
# deploy, not dev: it applies what is already written and never invents a
# migration or prompts, which is what you want on a server.
npx prisma migrate deploy

if [[ $BUILD -eq 1 ]]; then
  say "Building"
  npm run build
else
  say "Skipping build (--no-build)"
fi

say "Reloading"
# startOrReload: starts anything not running, reloads what is. This is the line
# that stops redeploys piling up duplicate processes.
pm2 startOrReload ecosystem.config.js --update-env

# So the list survives a reboot.
pm2 save >/dev/null

say "Running"
pm2 ls

# The port comes from .env, so this note matches wherever it is actually
# listening rather than a number written into this file.
PORT_IN_USE="$(node -p "require('./ecosystem.config.js').apps.find(a=>a.name==='cidco-web').env.PORT" 2>/dev/null || echo 3000)"

cat <<NOTE

Check it took:
  pm2 logs cidco-poll --lines 5             a line every POLL_INTERVAL_MS
  curl -s localhost:${PORT_IN_USE}/api/health   {"database":"connected"}
  the Data tab should read "Poll worker last ran Ns ago."
NOTE
