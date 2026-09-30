## 12.1.0 — REA Sync resolution hotfix

Принудительный прямой поиск по `?q=`, расширенный выбор результата и разбор уже отображённого расписания до попытки экспортировать `.ics`.

# Changelog

## 12.0.5
- Исправлен ручной refresh расписания: он больше не теряется из-за фоновой синхронизации.
- Добавлена явная offline-обратная связь.
- Sync Gateway получил более надёжный поиск группы через реальные autocomplete/results controls.
- Добавлены повторные варианты поиска для групп с `/`, пробелами и регистром.
- Добавлено обнаружение реального timetable state вместо ложного совпадения по глобальному тексту страницы.
- Добавлен capture сетевых search responses и попытка извлечения расписания без обязательного iCalendar download event.
- При повторном обновлении stale request не может перезаписать свежий результат.

## 12.0.5
- Fixed manual timetable refresh interaction.
- Do not block rasp.rea.ru service workers.
- Added explicit portal refresh before group search.
- Improved group search/click flow and rendered fallback.
- Network-first loading for JS/CSS/config/manifest reduces stale PWA builds after deploy.

## 12.0.5
- Fixed manual timetable refresh.
- Fixed stale PWA assets after deployment.
- Fixed REA portal search by allowing its service worker and explicitly submitting search.

## 12.0.5
- Fixed refresh interaction and stale PWA assets.
- Fixed REA portal offline-state caused by blocked service workers.
- Hardened group search and timetable detection.

## 12.1.0
- Полная синхронизация всех опубликованных недель из переключателя недель РЭУ.
- Ручное обновление сканирует прошлые и будущие недели.
- Фоновая синхронизация обновляет текущую неделю, не удаляя полный архив.
