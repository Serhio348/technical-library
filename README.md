# Technical Library

Универсальная библиотека нормативной и технической документации: **PDF/DOC → текст → OCR → поиск для ИИ**.

Пользователь (или Telegram-bot) **сам создаёт направления** (газ, электro, охрана труда, бухгалтерия…) и **подпапки** для подвидов внутри направления.

Отдельный проект от [osmos-modbus-service](https://github.com/Serhio348/osmos-modbus-service).

## Модель данных

| Уровень | Пример | API |
|---------|--------|-----|
| **Направление** | `gas` → «Газоснабжение» | `POST /api/library/directions` |
| **Подвид (папка)** | `gas/tkp`, `gas/Приказы` | `POST /api/library/directions/gas/folders` |
| **Документ** | PDF в подпапке | `POST .../directions/gas/upload` |

Фиксированного корня `regulations` **нет** — библиотека начинается пустой.

## Структура на диске

```
data/library/
  gas/
    _meta.json
    tkp/
    zakonodatelstvo/
  electro/
    gost/
  ohrana-truda/
```

Slug направления формируется **автоматически** из названия (`Газоснабжение` → `gazosnabzhenie`). Название для людей — в `_meta.json` (`title`).

## Быстрый старт

```bash
cp .env.example .env
npm install          # корень — скрипты dev/build
npm run dev          # API :3021 + UI :5174
```

Откройте **http://127.0.0.1:5174** (UI проксирует API).

Отдельно:

```bash
npm run dev:api      # только backend
npm run dev:web      # только UI (нужен запущенный API)
```

### Backend (вручную)

```bash
cd services/library && npm ci && npm run dev
curl http://127.0.0.1:3021/health
```

### Веб-интерфейс (вручную)

```bash
cd apps/web && npm ci && npm run dev
```

Пока запись (создание направления, upload) доступна без UI-авторизации — оставьте `LIBRARY_SHARED_SECRET` пустым в `.env`.

### Чат по документам (ИИ)

1. Добавьте в `.env`: `DEEPSEEK_API_KEY=sk-...` (ключ [DeepSeek API](https://platform.deepseek.com/))
2. Перезапустите API / контейнер
3. В UI откройте направление → кнопка **Чат** (справа от загрузки)
4. Задайте вопрос по текущей папке; ответ опирается на проиндексированные PDF (метка **ИИ** у файла)

Проверка: `GET /health` → `"llm_configured": true`

### Telegram-бот

Бот работает **в том же контейнере**, что и API (как в проекте Employees).

1. Создайте бота у [@BotFather](https://t.me/BotFather) → `/newbot` → скопируйте токен
2. В `.env`: `TELEGRAM_BOT_TOKEN=...` (локально можно `TELEGRAM_BOT_DISABLED=true`)
3. Опционально: `DEFAULT_DIRECTION_SLUG=electro`, `DEFAULT_SCOPE_PATH=tkp`
4. Перезапустите контейнер / `npm run dev`

Команды: `/directions`, `/dir slug`, `/folder путь`, `/search …`, `/ask …`, `/show` (полный ответ).

Проверка: `GET /health` → `"telegram_running": true`

```bash
curl -X POST http://127.0.0.1:3021/api/library/directions/gas/ask \
  -H "Content-Type: application/json" \
  -d '{"message":"Какие требования к газопроводу?","scope_path":"tkp"}'
```

### Production на VPS (фронт и бэкенд **раздельно**)

| Часть | Где | Как обновить |
|-------|-----|--------------|
| **Фронт (UI, иконка «Чат»)** | `apps/web/dist` → nginx `:8080` | `./scripts/build-web.sh` |
| **Бэкенд (API, OCR, чат)** | Docker `:3021` | `docker compose up -d --build` |

Полный деплой:

```bash
cd /opt/services/technical-library
git pull
chmod +x scripts/*.sh
./scripts/deploy-vps.sh
```

**Только фронт** (новая кнопка, стили — без пересборки API):

```bash
git pull
./scripts/build-web.sh
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo nginx -t && sudo systemctl reload nginx
```

Проверка UI (через nginx, как в браузере):

```bash
curl -s http://127.0.0.1:8080/ | grep assets
JS=$(curl -s http://127.0.0.1:8080/ | sed -n 's|.*src="/assets/\(index-[^"]*\.js\)".*|\1|p')
curl -s "http://127.0.0.1:8080/assets/$JS" | grep -o 'Чат'
```

Браузер: **http://192.168.11.83:8080** → Ctrl+F5.

Локально без nginx: `npm run build:web` + Docker — UI на **http://127.0.0.1:3021**.

## API (основное)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/library/directions` | Список направлений |
| POST | `/api/library/directions` | Создать направление `{ title }` (имя папки формируется автоматически) |
| GET | `/api/library/directions/:slug/tree?path=` | Дерево папок и файлов |
| POST | `/api/library/directions/:slug/folders` | Подпапка `{ path }` |
| POST | `/api/library/directions/:slug/upload` | Upload PDF |
| GET | `/api/library/directions/:slug/search?q=&scope_path=` | Поиск по тексту индекса |
| GET | `/api/library/directions/:slug/context?q=` | Контекст для LLM |
| POST | `/api/library/directions/:slug/ask` | Вопрос по документам (DeepSeek) |
| POST | `/api/library/directions/:slug/reindex` | Переиндекс OCR |

> `/api/library/installations/*` — устаревший alias тех же маршрутов.

## Docker (только API)

Контейнер — **бэкенд** на **127.0.0.1:3021**. UI на VPS отдаёт **nginx** из `apps/web/dist`.

```bash
git pull
COMPOSE_BAKE=false docker compose up -d --build
```

## Nginx (VPS, рядом с osmos)

| Сервис | URL |
|--------|-----|
| Osmos | http://192.168.11.83 |
| **Technical Library** | **http://192.168.11.83:8080** |

Установка:

```bash
cd /opt/services/technical-library
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo ln -sf /etc/nginx/sites-available/technical-library /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Подробнее: [deploy/nginx/README.md](deploy/nginx/README.md)

Опционально **http://library.local** — прописать `192.168.11.83 library.local` в `hosts` на ПК.

## Производительность загрузки и индексации

**Загрузка и OCR — разные процессы.** Файл сохраняется сразу; индексация (OCR PDF) идёт в фоне. Если «не даёт загружать» — чаще всего сервер занят OCR или упёрся в лимиты.

### Настройки в `/opt/services/technical-library/.env`

| Переменная | Рекомендация | Зачем |
|------------|--------------|-------|
| `LIBRARY_MAX_FILE_MB` | `200` | Макс. размер одного файла |
| `LIBRARY_UPLOAD_MAX_FILES` | `20` | Сколько файлов за один клик «Загрузить» |
| `LIBRARY_OCR_MAX_CONCURRENT` | **`1`** | Сколько **OCR** (tesseract) одновременно. **2+ на VPS = зависания** |
| `LIBRARY_INDEX_MAX_CONCURRENT` | `1`–`2` | Сколько задач индексации параллельно (Word/TXT). OCR всё равно ждёт слот выше |
| `LIBRARY_OCR_MAX_PAGES` | `50`–`150` | Лимит страниц OCR на PDF (350 = очень долго) |
| `LIBRARY_OCR_DPI` | `150` | 150 быстрее, 200 точнее |
| `LIBRARY_OCR_TIMEOUT_SEC` | `900`–`1800` | Таймаут на весь PDF; 3000 не ускоряет, только маскирует зависание |

После правки `.env`:

```bash
cd /opt/services/technical-library
docker compose up -d --build
```

### Nginx (таймаут тела запроса)

По умолчанию nginx обрывает медленную загрузку через **60 с**. В `deploy/nginx/technical-library.conf` задано `client_body_timeout 600s` и `client_max_body_size 512M`. После обновления конфига:

```bash
sudo cp deploy/nginx/technical-library.conf /etc/nginx/sites-available/technical-library
sudo nginx -t && sudo systemctl reload nginx
```

### Практические советы

- Не запускайте **«Переиндексировать папку»** на сотни PDF, если нужно активно загружать файлы — OCR забирает CPU.
- Word/TXT/DOCX индексируются за секунды; тормозят в основном **сканы и большие PDF**.
- Проверка лимитов: `curl -s http://127.0.0.1:3021/health | jq`

## Типы документов

`law`, `standard`, `tkp`, `regulation`, `instruction`, `classifier`, `other` — см. `*.library.json`.

## Связь с osmos

Разные репозитории, один VPS возможен: osmos `:3020`, Technical Library `:3021`.
