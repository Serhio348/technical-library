# План Technical Library

## Этап 1 (текущий) — library service

- [x] Fork PDF/OCR pipeline из osmos-doc-library
- [x] Типы документов для нормативки (law, standard, tkp, …)
- [x] Docker, порт 3021
- [ ] Telegram-bot (отдельный repo или `services/telegram-bot/`)

## Этап 2 — Telegram bot

- Whitelist user id
- Выбор направления (папка)
- Upload PDF / вопрос текстом
- `/context` + DeepSeek → ответ с цитатой

## Этап 3 — метаданные НПА

- Дата редакции, статус (действует / отменён)
- Предупреждение в ответе LLM

## Этап 4 — классификаторы

- CSV/Excel → structured search по кодам

## VPS

```text
/opt/services/osmos-modbus-service/     → :3020 osmos-doc-library
/opt/services/technical-library/      → :3021 technical-library
```

Отдельные volume, отдельные compose.
