# Tavrimo

**Tavrimo 9.1.0 Final** — offline-first personal planner for iPhone with manual time placement. You choose the date and start time; Tavrimo validates working hours, lunch, duration, deadlines, conflicts and reserve after each task.

## 10.0.0

Небольшое UI-обновление: понятные эмодзи для основных иконок интерфейса без изменения логики ручного планирования.

## 9.1.0
- Manual-only scheduling: the app never chooses a task time for the user.
- New tasks can be saved without a slot and scheduled later.
- Manual slots validate working hours, lunch, deadlines, duration and conflicts.
- Existing schedules from previous versions are treated as manual slots.
- Priority, duration and deadline remain meaningful for ordering, load and validation.
- Preserves offline-first PWA behavior, Focus, statistics, import/export and local storage.

## Install
Open the GitHub Pages URL in Safari and choose **Share → Add to Home Screen**. After the first successful load, the app can continue working offline.

## Update
Replace the published project files with the contents of `personal-planner`, open Tavrimo once with internet access and accept the in-app update banner when it appears.

## Data
Tasks, schedules, settings and focus sessions are stored locally on the device. Export a JSON backup before resetting or moving data to another device.

## Development
- `app.js` — application logic and manual scheduling validation
- `style.css` — iOS-first UI
- `sw.js` — offline cache and updates
- `manifest.webmanifest` — PWA metadata
- `tools/test_manual_scheduling.mjs` — regression tests
