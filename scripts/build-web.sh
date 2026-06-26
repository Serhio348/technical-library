#!/usr/bin/env bash
# Сборка фронтенда → apps/web/dist (на VPS без установленного Node — через Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"

echo "==> build frontend (apps/web → dist)"
docker run --rm \
  -v "$WEB:/web" \
  -w /web \
  node:22-alpine \
  sh -c "npm ci 2>/dev/null || npm install && npm run build && chmod -R a+rX dist"

if [[ ! -f "$WEB/dist/index.html" ]]; then
  echo "ERROR: dist/index.html не создан"
  exit 1
fi

echo "==> права (nginx www-data должен читать dist)"
chmod -R a+rX "$WEB/dist" 2>/dev/null || sudo chmod -R a+rX "$WEB/dist"

echo "==> dist:"
ls -la "$WEB/dist/assets/" | head -5

JS=$(grep -o 'assets/index-[^"]*\.js' "$WEB/dist/index.html" | head -1 | sed 's|assets/||')
if [[ -n "$JS" ]] && grep -q 'Чат' "$WEB/dist/assets/$JS"; then
  echo "OK: «Чат» найден в dist/assets/$JS"
else
  echo "WARN: «Чат» не найден в бандле — проверьте git pull"
  exit 1
fi
