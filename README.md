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

Slug направления — **латиница** (`gas`, `ohrana-truda`). Название для людей — в `_meta.json` (`title`).

## Быстрый старт

```bash
cp .env.example .env
cd services/library && npm ci && npm run dev
curl http://127.0.0.1:3021/health
curl http://127.0.0.1:3021/api/library/directions
```

## API (основное)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/library/directions` | Список направлений |
| POST | `/api/library/directions` | Создать направление `{ slug, title }` |
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
