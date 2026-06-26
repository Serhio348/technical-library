# Technical Library

Хранилище нормативной и технической документации: **PDF/DOC → текст → OCR → поиск для ИИ**.

Отдельный проект от [osmos-modbus-service](https://github.com/Serhio348/osmos-modbus-service).  
Предназначен для законов, правил, ГОСТ/СП, ТКП, инструкций по **газоснабжению**, **электроснабжению**, **охране труда**, бухгалтерским классификаторам и т.п.

Telegram-бот и другие клиенты подключаются через REST API.

## Возможности

- Загрузка PDF, DOC/DOCX, MD, TXT, JPEG, PNG
- Извлечение текста: `pdf-parse` + **Tesseract OCR** (rus+eng) для сканов
- Sidecar-индекс: `*.extracted.txt`, `*.extracted.pages.json`, `*.library.json`
- API: папки, upload, catalog, search, **context** для LLM
- Типы документов: law, standard, tkp, regulation, instruction, classifier

## Структура

```
technical-library/
  services/library/     # HTTP-сервис :3021
  data/library/         # файлы на диске (volume)
  docs/PLAN.md
  docker-compose.yml
```

Пример данных:

```
data/library/
  regulations/
    gas/
    electro/
    ohrana-truda/
    buhgalteriya/
```

## Быстрый старт (локально)

```bash
cp .env.example .env
cd services/library && npm ci && npm run dev
```

```bash
curl http://127.0.0.1:3021/health
```

## Docker (VPS)

```bash
cp .env.example .env
docker compose up -d --build
```

Порт по умолчанию **3021** (не конфликтует с osmos-doc-library на 3020).

## API

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус |
| GET | `/api/library/installations` | Коллекции |
| GET | `/api/library/installations/:slug/tree` | Дерево файлов |
| GET | `/api/library/installations/:slug/catalog` | Каталог с типами |
| POST | `/api/library/installations/:slug/upload` | Upload (secret) |
| GET | `/api/library/installations/:slug/context?q=` | Контекст для ИИ |
| POST | `/api/library/installations/:slug/reindex` | Переиндекс OCR |

## Связь с osmos

- **Общий VPS** — да, разные compose и volume.
- **Общий контейнер** — нет: osmos = оборудование, Technical Library = нормативка.

## Лицензия

Private / по согласованию с владельцем репозитория.
