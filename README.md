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

### Production (UI + API в одном контейнере)

```bash
docker compose up -d --build
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
| POST | `/api/library/directions/:slug/reindex` | Переиндекс OCR |

> `/api/library/installations/*` — устаревший alias тех же маршрутов.

## Docker

```bash
docker compose up -d --build
```

Порт **3021**.

## Типы документов

`law`, `standard`, `tkp`, `regulation`, `instruction`, `classifier`, `other` — см. `*.library.json`.

## Связь с osmos

Разные репозитории, один VPS возможен: osmos `:3020`, Technical Library `:3021`.
