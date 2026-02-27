# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
# Install production deps only
RUN npm install --omit=dev --ignore-scripts

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

# Non-root user for safety
RUN addgroup -S relay && adduser -S relay -G relay

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY server.js      ./
COPY decoy-site/    ./decoy-site/

USER relay

EXPOSE 3000

# Use tini for proper signal forwarding and zombie reaping
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
