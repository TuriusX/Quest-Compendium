# The guide pipeline's Cloud Run job image: the repo's scripts and website with production dependencies (tsx runs the
# TypeScript directly). Kept separate from the server's Dockerfile, whose image only holds the built app.
# Built with scripts/pipeline/cloudbuild.yaml (see README.md).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# tsx on the PATH, so a run with other arguments (gcloud run jobs execute --args=tsx,scripts/…) starts it directly; without
# it the node image's entrypoint read "tsx" as a script file and crashed with "Cannot find module '/app/tsx'".
ENV PATH=/app/node_modules/.bin:$PATH
CMD ["npx", "tsx", "scripts/pipeline/run.ts"]
