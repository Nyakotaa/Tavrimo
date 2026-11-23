/*
  Tavrimo runtime configuration.
  Same-origin is used on the combined Render deployment.
  When the UI is opened from GitHub Pages, use the configured Render gateway automatically.
*/
(() => {
  const host = window.location.hostname || '';
  const isGitHubPages = /\.github\.io$/i.test(host);
  const defaultSyncEndpoint = isGitHubPages
    ? 'https://tavrimo-rea-sync.onrender.com/api/rea/schedule'
    : '/api/rea/schedule';
  const defaultCalendarFeedEndpoint = isGitHubPages
    ? 'https://tavrimo-rea-sync.onrender.com/api/calendar/feed'
    : '/api/calendar/feed';
  window.TAVRIMO_CONFIG = Object.assign({
    syncEndpoint: defaultSyncEndpoint,
    calendarFeedEndpoint: defaultCalendarFeedEndpoint,
    calendarFeedRefreshMinutes: 30,
    syncIntervalMinutes: 15,
    requestTimeoutMs: 60000,
    scheduleSnapshotManifest: 'data/schedules/manifest.json'
  }, window.TAVRIMO_CONFIG || {});
})();
