# Tavrimo 12.0.2 — исправление 502 Sync Gateway

## Симптом

В Render запрос расписания возвращал `502`, а в логах было:

`browserType.launch: Executable doesn't exist at /ms-playwright/.../chrome-headless-shell`

## Причина

Сервис ожидал Chromium/Chrome Headless Shell в каталоге Playwright, но бинарник не был гарантированно установлен в итоговый Docker-образ.

## Исправление

Dockerfile теперь:

1. использует Node 20 Bookworm Slim;
2. устанавливает точную версию `playwright@1.55.0`;
3. во время сборки выполняет `npx playwright install --with-deps chromium`;
4. сразу проверяет наличие `chromium.executablePath()` и ломает build, если бинарника нет;
5. задаёт `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` явно.

Health endpoint `/api/rea/health` теперь возвращает `503`, если бинарник действительно отсутствует, и показывает `executablePath`.

## После обновления GitHub

Render → `tavrimo-rea-sync` → **Manual Deploy → Deploy latest commit**.

Затем откройте:

`https://tavrimo-rea-sync.onrender.com/api/rea/health`

Нормальный результат должен содержать:

```json
{
  "ok": true,
  "executableExists": true
}
```
