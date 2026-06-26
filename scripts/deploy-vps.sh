#!/usr/bin/env bash
# Полный деплoy на VPS: API + UI (apps/web собирается в Docker-образ).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> git pull"
git pull

export COMPOSE_BAKE=false
export WEB_CACHEBUST="${WEB_CACHEBUST:-$(date +%s)}"

echo "==> docker compose build (UI + API, без кэша web-слоя: WEB_CACHEBUST=$WEB_CACHEBUST)"
docker compose build --no-cache

echo "==> docker compose up -d"
docker compose up -d

echo "==> health"
curl -sf http://127.0.0.1:3021/health
echo

echo "==> assets"
curl -s http://127.0.0.1:3021/ | grep -E 'assets/index-' || true

JS=$(curl -s http://127.0.0.1:3021/ | sed -n 's|.*src="/assets/\(index-[^"]*\.js\)".*|\1|p' | head -1)
if [[ -n "$JS" ]]; then
  echo "==> проверка UI (кнопка «Чат» в бандле)"
  if curl -sf "http://127.0.0.1:3021/assets/$JS" | grep -q 'Чат'; then
    echo "OK: фронтенд обновлён (найден «Чат» в $JS)"
  else
    echo "WARN: «Чат» не найден в $JS — проверьте git log и пересборку"
    exit 1
  fi
fi

echo "Готово. В браузере: http://<IP>:8080 и Ctrl+F5"
