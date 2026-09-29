# Deterministic Render runtime for Tavrimo REA Sync.
# We install the exact Playwright browser used by the app during the image build,
# instead of relying on the pre-bundled browser layer being present.
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY sync-service/package.json /app/sync-service/package.json

# Install the app dependencies first, then install the exact Chromium build
# required by that Playwright package. The browser-smoke check makes the build
# fail early if the expected executable is missing.
RUN cd /app/sync-service \
    && npm install --omit=dev --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && node -e "const { chromium } = require('playwright'); const fs = require('node:fs'); const p = chromium.executablePath(); if (!fs.existsSync(p)) { console.error('Chromium executable missing:', p); process.exit(1); } console.log('Playwright Chromium ready:', p);"

COPY . /app

ENV PORT=3000
EXPOSE 3000

CMD ["node", "sync-service/server.mjs"]
