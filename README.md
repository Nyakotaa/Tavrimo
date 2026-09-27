# Flowday

> Offline-first персональный планировщик для iPhone: Flowday сам распределяет задачи по свободным часам с учётом приоритета, дедлайна, длительности и рабочего времени.

![Flowday](https://img.shields.io/badge/platform-iPhone%20%7C%20PWA-246BFE)
![Flowday](https://img.shields.io/badge/mode-offline--first-19855D)
![Flowday](https://img.shields.io/badge/version-5.0.0-745CF7)

## Для чего проект

Flowday создан для личного и учебного планирования. Это не просто список задач: задача может быть оставлена «входящей», а затем Flowday подберёт для неё свободное окно до дедлайна.

Проект не требует сервера для обычной работы. Задачи, расписание, настройки и статистика сохраняются локально на устройстве пользователя.

## Возможности

- автоматическое планирование до дедлайна;
- учёт приоритета, длительности и свободного времени;
- ручные слоты, которые не двигаются при перепланировании;
- рабочие часы, обед, буфер и опциональное планирование выходных;
- экран «Сегодня» без перегруза;
- недельный календарь;
- библиотека задач с поиском и фильтрами;
- режим «Фокус» с таймером;
- недельная статистика;
- импорт и экспорт резервной копии JSON;
- светлая, тёмная и системная тема;
- офлайн-работа после первого запуска;
- обновление PWA без удаления приложения с экрана «Домой»;
- iPhone-safe-area и touch-first интерфейс.

## Быстрый старт

1. Создай репозиторий на GitHub, например `flowday`.
2. Загрузи **содержимое этой папки** в корень репозитория.
3. В GitHub открой `Settings → Pages`.
4. В `Build and deployment` выбери `Deploy from a branch`.
5. Выбери ветку `main` и папку `/(root)`.
6. Сохрани настройки и дождись появления ссылки GitHub Pages.
7. Открой ссылку в Safari на iPhone.
8. Нажми `Поделиться → На экран «Домой»`.

Подробная инструкция: [`docs/INSTALL_RU.md`](docs/INSTALL_RU.md).

## Офлайн-режим

Первое открытие должно быть сделано по HTTPS, чтобы браузер мог зарегистрировать Service Worker. После кэширования app shell приложение может открываться и выполнять основную логику без сети.

Важно: локальные задачи и настройки хранятся на конкретном устройстве. У двух пользователей будут независимые данные.

## Обновление

Для новой версии:

1. замени файлы в том же GitHub-репозитории;
2. увеличь версию в `index.html`, `app.js`, `manifest.webmanifest` и `sw.js`;
3. закоммить изменения;
4. открой приложение на iPhone с интернетом;
5. при обнаружении нового Service Worker Flowday покажет кнопку `Обновить`.

Инструкция: [`docs/UPDATE_RU.md`](docs/UPDATE_RU.md).

## Иконка

Для iPhone PWA отдельно используется `apple-touch-icon` 180×180 px; в манифесте также лежат PNG 192×192 и 512×512 для совместимости с другими установочными механизмами. Safari/iOS отдаёт приоритет `apple-touch-icon`, если он указан в HTML.

Самый удобный исходник — квадратный PNG 1024×1024. Положи его в `assets/icons/source-icon-1024.png` и запусти `python3 tools/build_icons.py`, после чего обнови сайт.

Подробно: [`docs/ICON_RU.md`](docs/ICON_RU.md).

## Описание для GitHub

**Repository description:**

> Offline-first PWA-планировщик для iPhone: автоматически распределяет задачи по свободным часам с учётом приоритета, дедлайна и рабочего времени.

**Рекомендуемые topics:**

`pwa`, `ios`, `iphone`, `productivity`, `planner`, `task-manager`, `offline-first`, `github-pages`, `javascript`, `html`, `css`, `student`, `schedule`

## Релиз v5.0.0

Релизная версия получила чистый старт без демо-записей, единый UI без «висячих» элементов, более строгую валидацию ручных слотов, обновлённый офлайн-кэш, управляемое обновление Service Worker и отдельную документацию для GitHub Pages.

Подробно: [`CHANGELOG.md`](CHANGELOG.md) и [`RELEASE_NOTES_RU.md`](RELEASE_NOTES_RU.md).

## Структура

```text
personal-planner/
├── index.html
├── style.css
├── app.js
├── manifest.webmanifest
├── sw.js
├── 404.html
├── CHANGELOG.md
├── RELEASE_NOTES_RU.md
├── docs/
│   ├── INSTALL_RU.md
│   ├── UPDATE_RU.md
│   ├── ICON_RU.md
│   └── RELEASE_CHECKLIST_RU.md
├── assets/icons/
└── tools/
```

## Ограничения

Flowday сознательно остаётся локальным приложением. Здесь нет общей синхронизации между телефонами, аккаунтов и серверной базы данных. Если телефон очистит данные сайта/PWA, локальная база может быть потеряна — используй экспорт JSON для резервной копии.

## Лицензия

Проект подготовлен для личного/учебного использования. Перед публичным распространением добавь выбранную тобой лицензию и свои условия использования.

## Официальные справочные материалы

- Apple — Web Clips / `apple-touch-icon`: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- WebKit — Web App Manifest и иконки в iOS: https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/
- GitHub Docs — GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- web.dev — Service Worker и обновления PWA: https://web.dev/learn/pwa/service-workers
