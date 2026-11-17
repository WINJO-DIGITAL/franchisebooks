# Background worker: Node + Playwright (Chromium). Runs the DPD portal jobs and the scheduler.
# Build from the repository root:   docker build -f worker/Dockerfile -t dpd-worker .
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    SERVICE_NAME=worker \
    PORT=8787

WORKDIR /app
COPY package.json package-lock.json ./
# tsx runs the TypeScript worker directly, so dev dependencies are needed here too.
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY worker ./worker

# The base image already contains the matching Chromium build.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "--conditions=react-server", "worker/index.ts"]
