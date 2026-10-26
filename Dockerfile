# Quest Compendium web app + API server, for Cloud Run (deployed automatically from GitHub).

# ---- Build: install everything, build the web app (dist/) and the server bundle (dist/server.cjs)
FROM node:22.23.4-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Run: production dependencies only
FROM node:22.23.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
# The Node.js release in the image, in the build log (pinned to the line's security release; Oct 2026: 22.23.4).
RUN node -v
COPY --from=build /app/dist ./dist
COPY public ./public
# The server listens on port 3000 (set the Cloud Run container port to 3000).
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
