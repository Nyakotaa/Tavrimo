# Tavrimo 12.0.5 — Hotfix для кнопки обновления и РЭУ

## Причины

- PWA мог продолжать выполнять старый `app.js` из старого cache key.
- Кнопка ручного обновления могла быть заблокирована во время фоновой синхронизации.
- `navigator.onLine` использовался как жёсткое условие, хотя это только эвристический флаг.
- Sync Gateway блокировал Service Worker `rasp.rea.ru`, из-за чего портал мог показывать stale/offline состояние и не находить группу.

## Исправления

- cache-busting для `app.js`, `style.css`, `config.js`;
- network-first для JS/CSS/config/manifest в Service Worker;
- кнопка обновления больше не переводится в HTML-disabled;
- добавлен delegated click handler для ручного refresh;
- принудительное обновление не игнорируется при фонеой синхронизации;
- REA Sync Gateway разрешает Service Worker официального портала;
- перед поиском группы обновляется портал;
- поиск выполняет submit через кнопку/Enter и повторно выбирает результат;
- сохранены iCalendar и rendered-page fallback.
