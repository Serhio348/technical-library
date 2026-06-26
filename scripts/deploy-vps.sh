#!/usr/bin/env bash
# VPS: фронт (nginx) + бэкенд (docker) — два отдельных шага.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> git pull"
git pull

echo ""
echo "========== 1/3 FRONTEND (apps/web/dist) =========="
chmod +x scripts/build-web.sh
./scripts/build-web.sh

echo ""
echo "========== 2/3 BACKEND (docker API) =========="
export COMPOSE_BAKE=false
docker compose up -d --build

echo ""
echo "==> health (API)"
curl -sf http://127.0.0.1:3021/health
echo

echo ""
echo "========== 3/3 NGINX (отдаёт dist на :8080) =========="
if [[ -f /etc/nginx/sites-available/technical-library ]]; then
  sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo "nginx conf не установлен — один раз:"
  echo "  sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library"
  echo "  sudo ln -sf /etc/nginx/sites-available/technical-library /etc/nginx/sites-enabled/"
fi

echo ""
echo "==> проверка UI через nginx :8080"
curl -s http://127.0.0.1:8080/ | grep -E 'assets/index-' || true

JS=$(curl -s http://127.0.0.1:8080/ | sed -n 's|.*src="/assets/\(index-[^"]*\.js\)".*|\1|p' | head -1)
if [[ -n "$JS" ]] && curl -sf "http://127.0.0.1:8080/assets/$JS" | grep -q 'Чат'; then
  echo "OK: фронт на :8080 обновлён («Чат» в $JS)"
else
  echo "WARN: на :8080 нет «Чат» — обновите nginx conf и перезагрузите nginx"
  exit 1
fi

echo ""
echo "Готово. Браузер: http://192.168.11.83:8080 → Ctrl+F5"
