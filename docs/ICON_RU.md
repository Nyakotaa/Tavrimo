# Иконка Tavrimo

## Исходник

Используется один мастер-файл:

`assets/icons/source-icon-1024.png`

Размер: **1024×1024 px**.

В проекте из него генерируются:

- `apple-touch-icon-v13.png` — 180×180 для iPhone Web App;
- `icon-180.png` — 180×180;
- `icon-192.png` — 192×192;
- `icon-512.png` — 512×512;
- `favicon-32.png` — 32×32.

## Как заменить

Замените `source-icon-1024.png` своей PNG-картинкой и запустите:

```bash
python3 tools/build_icons.py
```

Не меняйте вручную только один размер: Tavrimo использует несколько иконок одновременно, а `apple-touch-icon` подключён отдельно для iPhone.
