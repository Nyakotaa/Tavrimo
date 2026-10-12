## 12.0.9 — REA search order fix

- Fixed a 502 sync failure where the gateway tried direct `?q=` navigation first and then searched for the group field on the resulting page.
- The gateway now uses the official portal search field first, reloads the canonical `https://rasp.rea.ru/` page once if the field is missing, and only then tries direct query navigation as a fallback.
- Added broader search-field selectors while excluding login/password fields and extra diagnostics for cases when the portal does not render a search field.
- Preserved the 12.0.8 all-time calendar export path for importing past and future timetable events when the portal supports it.

## 12.0.8 — Full-range university timetable

- Fixed a control-flow bug that returned the currently visible week before attempting the REA calendar export.
- The sync gateway now attempts the portal's “За всё время” calendar export first, so past and future lessons can be imported together when REA exposes them.
- The currently rendered week remains a fallback if the portal export fails; logs explicitly mark that fallback as week-only instead of implying the full calendar was fetched.
- Bumped static asset and Service Worker versions to avoid keeping the previous release on installed PWAs.

## 12.0.7 — REA Sync resolution hotfix

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
