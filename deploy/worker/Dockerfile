# Background worker: Node + Chromium (Playwright) running worker/index.ts.
#
# Build from the REPOSITORY ROOT so the worker can share code from src/lib:
#   docker build -f deploy/worker/Dockerfile -t dpd-worker .
#   docker run --env-file .env.worker -p 8080:8080 dpd-worker
#
# The Playwright image already contains Chromium and every system library it
# needs. Keep its version in step with "playwright" in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    SERVICE_NAME=worker \
    PORT=8080 \
    # src/lib modules import "server-only", which throws outside Next.js unless this condition is set.
    NODE_OPTIONS=--conditions=react-server \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Install dependencies first so this layer is cached until package files change.
# Dev dependencies are needed too: the worker is run with tsx.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY worker ./worker

# Run as the unprivileged user that ships with the Playwright image.
RUN chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 8080

# The worker answers GET /health with 200 while it is running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "worker/index.ts"]
