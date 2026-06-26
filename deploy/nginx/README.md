# Nginx для Technical Library

На VPS **192.168.11.83** рядом с osmos:

| Сервис | URL |
|--------|-----|
| Osmos | http://192.168.11.83 |
| Technical Library | http://192.168.11.83:8080 |
| Library (с hosts) | http://library.local |

## Архитектура

```
Браузер :8080
    → nginx отдаёт apps/web/dist   (ФРОНТ — обновлять отдельно!)
    → /api/* прокси на :3021       (БЭК — docker)
```

## Обновить только фронт (иконка «Чат», UI)

```bash
cd /opt/services/technical-library
git pull
chmod +x scripts/build-web.sh
./scripts/build-web.sh
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo nginx -t && sudo systemctl reload nginx
```

Проверка:

```bash
JS=$(curl -s http://127.0.0.1:8080/ | sed -n 's|.*src="/assets/\(index-[^"]*\.js\)".*|\1|p')
curl -s "http://127.0.0.1:8080/assets/$JS" | grep -o 'Чат'
```

## Полный деплой (фронт + API + nginx)

```bash
cd /opt/services/technical-library
chmod +x scripts/deploy-vps.sh
./scripts/deploy-vps.sh
```

## Только API (без UI)

```bash
git pull
COMPOSE_BAKE=false docker compose up -d --build
curl -s http://127.0.0.1:3021/health
```

## Первичная установка nginx

```bash
cd /opt/services/technical-library
./scripts/build-web.sh
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo ln -sf /etc/nginx/sites-available/technical-library /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Firewall (если ufw включён)

```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

## library.local на порту 80

В `hosts` на ПК: `192.168.11.83  library.local` → **http://library.local**

## SSL (позже)

Когда появится публичный домен — certbot на блок `library.ваш-домен.ru`.
