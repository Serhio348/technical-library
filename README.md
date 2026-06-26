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

Для записи (создание направления, upload) укажите в UI **Доступ → x-library-secret** (значение `LIBRARY_SHARED_SECRET` из `.env`; если секрет пустой — запись без ключа).

### Чат по документам (ИИ)

1. Добавьте в `.env`: `DEEPSEEK_API_KEY=sk-...` (ключ [DeepSeek API](https://platform.deepseek.com/))
2. Перезапустите API / контейнер
3. В UI откройте направление → кнопка **Чат** (справа от загрузки)
4. Задайте вопрос по текущей папке; ответ опирается на проиндексированные PDF (метка **ИИ** у файла)

Проверка: `GET /health` → `"llm_configured": true`

```bash
curl -X POST http://127.0.0.1:3021/api/library/directions/gas/ask \
  -H "Content-Type: application/json" \
  -d '{"message":"Какие требования к газопроводу?","scope_path":"tkp"}'
```

### Production (UI + API в одном контейнере)

UI (`apps/web`) **собирается внутри Docker-образа** — отдельный деплой фронта не нужен, но после `git pull` обязателен **пересбор** образа:

```bash
git pull
COMPOSE_BAKE=false docker compose up -d --build
```

Проверка, что UI обновился (имя JS-бандла меняется при каждой сборке):

```bash
curl -s http://127.0.0.1:3021/ | grep -o 'assets/index-[^"]*\.js'
```

Если кнопки «Чат» нет — пересоберите без кэша и обновите страницу с Ctrl+F5:

```bash
COMPOSE_BAKE=false docker compose build --no-cache && docker compose up -d
```

UI: **http://127.0.0.1:3021**

## API (основное)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/library/directions` | Список направлений |
| POST | `/api/library/directions` | Создать направление `{ title }` (имя папки формируется автоматически) |
| GET | `/api/library/directions/:slug/tree?path=` | Дерево папок и файлов |
| POST | `/api/library/directions/:slug/folders` | Подпапка `{ path }` |
| POST | `/api/library/directions/:slug/upload` | Upload PDF |
| GET | `/api/library/directions/:slug/context?q=` | Контекст для LLM |
| POST | `/api/library/directions/:slug/ask` | Вопрос по документам (DeepSeek) |
| POST | `/api/library/directions/:slug/reindex` | Переиндекс OCR |

> `/api/library/installations/*` — устаревший alias тех же маршрутов.

## Docker

UI и API в одном контейнере. После обновления кода:

```bash
git pull
COMPOSE_BAKE=false docker compose up -d --build
```

Контейнер слушает **127.0.0.1:3021** (только localhost). Снаружи — через nginx.

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

## Типы документов

`law`, `standard`, `tkp`, `regulation`, `instruction`, `classifier`, `other` — см. `*.library.json`.

## Связь с osmos

Разные репозитории, один VPS возможен: osmos `:3020`, Technical Library `:3021`.
