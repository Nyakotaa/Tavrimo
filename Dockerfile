FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY sync-service/package.json /app/sync-service/package.json
RUN cd /app/sync-service && npm install --omit=dev
COPY . /app
ENV PORT=3000
EXPOSE 3000
CMD ["node","sync-service/server.mjs"]
