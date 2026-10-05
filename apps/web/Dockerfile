# Vita Family — frontend (PWA estática). Build com Node, servido por nginx sem privilégios.
# Uso: make web-up (local) · Dokploy: deploy/docker-compose.web.prod.yml (ADR-014)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Typecheck + testes + build: uma imagem só é criada se o código passar.
RUN npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
