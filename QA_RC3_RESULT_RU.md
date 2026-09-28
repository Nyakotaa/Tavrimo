# Tavrimo 9.0.0 — Release QA

Дата: 2026-09-27

## Автоматические проверки
- JavaScript syntax: PASS
- Service Worker syntax: PASS
- Scheduler regression: PASS
- New feature tests: PASS
- HTML duplicate IDs: PASS
- JS → HTML ID references: PASS
- Local resource references: PASS
- Manifest JSON: PASS
- Icon dimensions: PASS

## Новые функциональные проверки
- next-up отображение и переход к задаче
- одиночный поиск ближайшего свободного окна
- снятие времени без перестройки остальных задач
- расширенные фильтры задач
- состояние плана

## Ограничение
Полноценный физический тест на реальном iPhone из рабочей среды недоступен; перед финальным релизом рекомендуется проверить установку PWA, offline launch, обновление SW и смену иконки на реальном устройстве.
