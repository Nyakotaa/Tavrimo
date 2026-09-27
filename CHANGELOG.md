# Changelog

### 9.1.1 — 2026-09-28
- Replaced ambiguous text glyphs in navigation, search, Focus, Statistics, plan health and settings with familiar iOS-friendly emoji.
- Applied a restrained monochrome treatment to emoji icons so they stay visually quiet and aligned with the Flowday palette.
- Updated app version and service-worker cache key to 9.1.1.


### 9.1.0 Final — 2026-09-27
- Final manual-only release candidate promoted after full static, scheduler and mobile UI regression checks.
- Confirmed there is no automatic time selection or automatic plan rebuilding in the application UI or runtime.
- Confirmed manual task creation/editing, deadlines, durations, priorities, conflicts, buffer, completion/restore, Focus, filters, calendar, import/export and reset flows in the final regression pass.
- Service worker cache key changed to `flowday-v9.1.0-final` to force a clean final app-shell update over an older 9.1.0 installation.

## 9.1.0 — 2026-09-27
- Switched task scheduling to manual-only placement.
- Removed automatic time selection from task creation and editing.
- Removed single-task auto-rescheduling and plan rebuilding actions.
- Existing scheduled tasks from older versions are migrated to manual slots.
- Manual validation now covers partial date/time entry, working hours, lunch, buffer, deadlines and conflicts.
- Added a stable urgency sort for task lists so priority still has a visible, meaningful effect without changing scheduled times.
- Updated local schema to v11 and service worker cache to 9.1.0.
- Added manual scheduling regression tests and updated GitHub Actions validation.
