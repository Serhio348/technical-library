# План Technical Library

## Модель (v0.2)

- [x] Универсальная библиотека без фиксированного `regulations`
- [x] Направления = папки верхнего уровня (`/directions`)
- [x] Подвиды = вложенные папки внутри направления
- [x] Веб-UI (`apps/web`) — карточки направлений, подпапки, upload
- [x] Чат в UI — `POST .../directions/:slug/ask` (DeepSeek + контекст из индекса)
- [x] Telegram-bot MVP — поиск и /ask (preview + /show) в том же контейнере
- [ ] Telegram-bot — upload, направления, папки (фаза 2)
- [ ] Пользователи / права на направление
- [ ] Метаданные НПА: дата редакции, статус

## VPS

```text
/opt/services/osmos-modbus-service/   → :80  (nginx)  http://192.168.11.83
/opt/services/technical-library/    → :3021 (docker, localhost)
                                      → :8080 (nginx)  http://192.168.11.83:8080
                                      → :80   library.local (nginx + hosts)
```

## Пример сценария bot

1. `/newdirection gas Газоснабжение`
2. `/newfolder tkp`
3. Upload PDF в `gas/tkp/`
4. Вопрос в UI (кнопка «Чат») или `POST .../directions/gas/ask` с `scope_path=tkp`
