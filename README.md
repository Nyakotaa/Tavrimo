# Flowday

**Flowday 9.0.0** — offline-first personal planner for iPhone. It automatically places tasks into available work windows using duration, deadline, priority, manual blocks and buffer.

## 9.0.0
This release adds a next-up task card, plan health dashboard, advanced task filters, weekly load indicators and one-task rescheduling actions while keeping the interface intentionally compact.

## Install
Open the GitHub Pages URL in Safari and choose **Share → Add to Home Screen**. After the first successful load, the app can continue working offline.

## Update
Replace the published project files with the contents of `personal-planner`, open Flowday once with internet access and accept the in-app update banner when it appears.

## Data
Tasks, schedules, settings and focus sessions are stored locally on the device. Export a JSON backup before resetting or moving data to another device.

## Development
- `app.js` — application and scheduler logic
- `style.css` — iOS-first UI
- `sw.js` — offline cache and updates
- `manifest.webmanifest` — PWA metadata
- `tools/test_scheduler.mjs` — regression tests
