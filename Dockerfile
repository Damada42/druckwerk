# Druckwerk als Container: Oberfläche bauen, dann nur Server + gebaute Oberfläche ausliefern.
# Läuft hinter einem Reverse-Proxy (z.B. Cloudflare-Tunnel → Authentik-Outpost), der HTTPS macht.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build -w client

FROM node:24-bookworm-slim
WORKDIR /app
# Dasselbe Image läuft auch als Home-Assistant-App (ha-app/config.yaml); die Labels braucht der Supervisor
ARG BUILD_VERSION=dev
LABEL io.hass.type="addon" \
      io.hass.arch="amd64" \
      io.hass.version="${BUILD_VERSION}"
ENV NODE_ENV=production \
    HTTPS=false \
    API_PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TRUST_PROXY=true
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# Nur was der Server zur Laufzeit braucht (better-sqlite3 lädt ein fertiges Binary für Linux)
RUN npm ci --omit=dev -w server -w shared && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY --from=build /app/client/dist client/dist

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
