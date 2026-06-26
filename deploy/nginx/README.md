# Nginx для Technical Library

На VPS **192.168.11.83** рядом с osmos:

| Сервис | URL |
|--------|-----|
| Osmos | http://192.168.11.83 |
| Technical Library | http://192.168.11.83:8080 |
| Library (с hosts) | http://library.local |

## 1. Контейнер

```bash
cd /opt/services/technical-library
git pull
COMPOSE_BAKE=false docker compose up -d --build
curl -s http://127.0.0.1:3021/health
```

## 2. Nginx

```bash
cd /opt/services/technical-library
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo ln -sf /etc/nginx/sites-available/technical-library /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 3. Firewall (если ufw включён)

```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

## 4. Проверка с ПК в сети

```text
http://192.168.11.83:8080
```

## 5. Опционально: library.local на порту 80

На Windows (`C:\Windows\System32\drivers\etc\hosts`, от администратора):

```text
192.168.11.83  library.local
```

На Linux/macOS: `/etc/hosts` — та же строка.

После этого: **http://library.local**

## Замена IP

Если IP VPS другой — отредактируйте `server_name` в первом блоке `technical-library.conf`.

## SSL (позже)

Когда появится публичный домен — certbot на блок `library.ваш-домен.ru`.
