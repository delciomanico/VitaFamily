# Vita Family — frontend (PWA estática). Build com Node, servido por nginx sem privilégios.
# Uso: make web-up (local) · Dokploy: deploy/docker-compose.web.prod.yml (ADR-014)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Testes correm SEM VITE_API_URL: dependem dos mocks (services/*.service.ts decide a ramificação
# mock/API real neste valor no carregamento do módulo — com a variável definida, o AuthProvider
# tentaria mesmo um fetch real a /api/v1/auth/refresh e os testes bloqueavam/timeout).
RUN npm test
# Mesma origem em produção (ADR-017/ADR-019): o nginx deste contentor reencaminha /api/ para o
# backend, por isso o caminho é relativo e fixo — não é segredo, não precisa de vir de fora da
# imagem. Só agora, para o build real: sem isto o build cairia nos mocks (hasApiBackend() falso).
ENV VITE_API_URL=/api/v1
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# O Traefik do Dokploy só encaminha para contentores healthy: verificar cedo e com frequência.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --start-interval=2s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
