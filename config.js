/*
  Tavrimo runtime configuration.
  For local / combined deployment the default same-origin API is enough.
  For GitHub Pages set syncEndpoint to the public URL of the Tavrimo Sync Gateway.
*/
window.TAVRIMO_CONFIG = Object.assign({
  syncEndpoint: '/api/rea/schedule',
  syncIntervalMinutes: 15,
  requestTimeoutMs: 25000
}, window.TAVRIMO_CONFIG || {});
