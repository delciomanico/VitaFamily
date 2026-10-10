# Vita Family — backend (ADR-014/ADR-015: Node.js/TypeScript). Monorepo pnpm: o contexto de build
# é a raiz do repositório (ver docker-compose.api.prod.yml `build.context: ..`), não este diretório,
# para o pnpm conseguir resolver o workspace (pnpm-workspace.yaml, pnpm-lock.yaml).
# Uso: deploy/docker-compose.api.prod.yml (Dokploy, ADR-017). Mesma imagem serve "api" e "worker"
# (main/worker.ts) — o processo é escolhido pelo `command:` de cada serviço no compose.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM base AS build-deps
RUN pnpm install --filter @vitafamily/api... --frozen-lockfile

FROM build-deps AS build
COPY apps/api apps/api
# Os testes (http.test.ts) carregam o contrato para validar a app: precisa de existir no build context.
COPY docs/05-api/openapi.yaml docs/05-api/openapi.yaml
# Typecheck + testes antes do build: uma imagem só é criada se o código passar (mesmo critério do
# apps/web/Dockerfile). `tests/integration/**` usa testcontainers (precisa do socket Docker do
# anfitrião) — não corre aqui; corre em CI, fora da sandbox de build.
RUN pnpm --filter @vitafamily/api exec eslint . \
  && pnpm --filter @vitafamily/api exec vitest run --exclude "tests/integration/**" \
  && pnpm --filter @vitafamily/api run build

FROM base AS prod-deps
RUN pnpm install --filter @vitafamily/api... --frozen-lockfile --prod

FROM node:22-alpine AS runtime
RUN addgroup -S vita && adduser -S vita -G vita
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/package.json apps/api/package.json
# tsc não copia ficheiros não-.ts: as migrações (.sql) têm de ir para o mesmo diretório do
# migrate-runner.js compilado (dist/db/migrations), de onde `defaultMigrationsDir()` as lê.
COPY apps/api/db/migrations apps/api/dist/db/migrations
COPY docs/05-api/openapi.yaml docs/05-api/openapi.yaml
USER vita
EXPOSE 8080
# O Traefik do Dokploy só encaminha para contentores healthy (mesmo critério do apps/web/Dockerfile).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --start-interval=2s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["node", "apps/api/dist/src/main/api.js"]
