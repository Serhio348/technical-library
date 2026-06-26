# Данные Technical Library

Универсальная библиотека: **направления** создаёт пользователь (через API или bot).

```
data/library/
  gas/                    ← направление (slug латиницей)
    _meta.json            ← { "title": "Газоснабжение" }
    tkp/                  ← подвид / подпапка
    zakonodatelstvo/
  electro/
    _meta.json
    gost/
  ohrana-truda/
    instrukcii/
  buhgalteriya/
    klassifikatory/
```

- **Направление** — папка верхнего уровня (`slug`: `a-z`, `0-9`, `-`).
- **Подвиды** — вложенные папки внутри направления (имя может быть на кириллице).
- PDF в git не коммитятся.

Создание направления:

```bash
curl -X POST -H "Content-Type: application/json" \
  -H "x-library-secret: SECRET" \
  -d '{"slug":"gas","title":"Газоснабжение"}' \
  http://127.0.0.1:3021/api/library/directions
```

Создание подпапки (подвид):

```bash
curl -X POST -H "Content-Type: application/json" \
  -H "x-library-secret: SECRET" \
  -d '{"path":"tkp"}' \
  http://127.0.0.1:3021/api/library/directions/gas/folders
```
