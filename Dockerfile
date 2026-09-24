# Quest Compendium web app + API server, for Cloud Run (deployed automatically from GitHub).

# ---- Build: install everything, build the web app (dist/) and the server bundle (dist/server.cjs)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Run: production dependencies only
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY public ./public
# The server listens on port 3000 (set the Cloud Run container port to 3000).
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
