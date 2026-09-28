# Tavrimo 8.0.0 RC2 — QA result

Дата: 27 сентября 2026

## Итог

RC2 закрывает основные дефекты RC1 из списка FD8-01…FD8-07 и дополнительно закрывает связанные UX/data issues FD8-09…FD8-15 на уровне кода и автоматических тестов.

## Исправлено

| ID | Статус RC2 | Исправление |
|---|---|---|
| FD8-01 | PASS | В автопланировщик добавлена проверка выполнимости оставшихся задач. Приоритет не может сломать более ранний дедлайн. |
| FD8-02 | PASS | Ручной слот отклоняется, если резерв после задачи пересекает обед. |
| FD8-03 | PASS | Импорт гарантирует уникальные ID задач. |
| FD8-04 | PASS | Неверная дата Focus-сессии удаляется из backup, а не переносится на текущий день. |
| FD8-05 | PASS | Отсутствующий дедлайн сохраняется как `null`; задача отображается как «Без дедлайна». Автопланирование использует ограниченный горизонт 14 дней. |
| FD8-06 | PASS | Конфликтующие locked/ручные слоты ремонтируются: первый валидный ручной слот сохраняется, конфликтующий возвращается во входящие. |
| FD8-07 | PASS | Выполненная задача всегда имеет статус «Выполнено» в label дедлайна. |
| FD8-09 | PASS | Focus привязан к дате начала сессии, поэтому сессия через полночь не переезжает в следующий день. |
| FD8-10 | PASS | Отмена системного share явно сообщает об отмене; прочая ошибка переходит к обычному download. |
| FD8-11 | IMPROVED | Manifest оставлен нейтральным для splash; iOS theme-color в HTML задаётся отдельно для light/dark. Полностью динамическая manifest-тема не является возможностью manifest API. |
| FD8-12 | PASS | Мёртвый `scheduleSingle()` удалён. |
| FD8-13 | PASS | Глобальный счётчик просроченных задач показывается в подписи только для сегодняшнего дня. |
| FD8-14 | PASS | Кнопка планирования явно называется «Перестроить план» / «Составить план», а aria-label объясняет глобальный характер действия. |
| FD8-15 | PRESERVED SAFELY | Миграция сохраняет прежнюю защитную очистку только полностью чистого legacy-demo набора, без риска удалить реальные данные по одному совпадению названия. |

## Автоматические тесты

Пройдено:

- `node --check app.js`
- `node --check sw.js`
- `node tools/test_scheduler.mjs`
- deadline-safe starvation case
- priority still influences a safe same-deadline plan
- manual buffer × lunch
- persisted slot after deadline
- duplicate task IDs in import
- invalid Focus date import
- no-deadline preservation
- no-deadline auto planning
- conflicting locked slots repair
- completed + overdue label
- malformed settings / task / slot data
- manifest / icon / Service Worker static validation
- GitHub Actions YAML parse

Результат scheduler suite:

```text
Scheduler regression tests passed.
```

Результат статической проверки:

```text
Static validation passed.
```

## UI/device limitation

Из этой среды локальные HTTP/file URL блокируются браузерным sandbox (`ERR_BLOCKED_BY_ADMINISTRATOR`), поэтому полный физический UI-прогон и реальное поведение Safari на iPhone не считаются выполненными. Перед `8.0.0 Final` остаются ручные device-level проверки: обновление RC1→RC2, установка Home Screen Web App, новая иконка, offline launch и Focus после блокировки экрана.
