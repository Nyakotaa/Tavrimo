# Иконка Flowday для iPhone

## Исходник
Используйте PNG **1024×1024 px**. Лучше без прозрачности.

Сохраните исходник как:

`assets/icons/source-icon-1024.png`

## Генерация
Запустите:

```bash
python3 tools/build_icons.py
```

Скрипт создаёт:
- `apple-touch-icon-v7.png` — 180×180, используется Safari на iPhone;
- `icon-180.png` — 180×180;
- `icon-192.png` — 192×192;
- `icon-512.png` — 512×512;
- `favicon-32.png` — 32×32.

Если Flowday уже был добавлен на экран «Домой», после замены иконки лучше удалить старый Web App и добавить его снова.
