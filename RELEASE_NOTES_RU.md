## Tavrimo 12.0.3 — REA Sync Resilience Hotfix

Эта версия исправляет 502 при автоматической загрузке расписания РЭУ.

Главное изменение: Sync Gateway больше не зависит только от события Playwright `download`. Он также умеет получить iCalendar из client-generated Blob/data URL, найденного export endpoint или, в крайнем случае, восстановить календарь из уже отрисованного расписания на странице rasp.rea.ru.

Источником остаётся официальный портал РЭУ: https://rasp.rea.ru/
