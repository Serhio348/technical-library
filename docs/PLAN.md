# План Technical Library

## Модель (v0.2)

- [x] Универсальная библиотека без фиксированного `regulations`
- [x] Направления = папки верхнего уровня (`/directions`)
- [x] Подвиды = вложенные папки внутри направления
- [ ] Telegram-bot (отдельный repo)
- [ ] Пользователи / права на направление
- [ ] Метаданные НПА: дата редакции, статус

## VPS

```text
/opt/services/osmos-modbus-service/   → :3020
/opt/services/technical-library/    → :3021
```

## Пример сценария bot

1. `/newdirection gas Газоснабжение`
2. `/newfolder tkp`
3. Upload PDF в `gas/tkp/`
4. Вопрос → `GET .../directions/gas/context?q=...&scope_path=tkp`
