# Vita Family — Makefile do monorepo (ADR-014/ADR-015: Node.js/TypeScript).

API_DIR := apps/api
DEV_COMPOSE ?= docker compose -p vitafamily -f deploy/docker-compose.dev.yml
PROD_COMPOSE ?= docker compose -p vitafamily-prod -f deploy/docker-compose.prod.yml
COMPOSE ?= $(DEV_COMPOSE)
WEB_COMPOSE ?= docker compose -f deploy/docker-compose.web.yml

.PHONY: help install gen test lint fmt build migrate image up down web-up web-down web-logs dev dev-down dev-logs prod prod-down prod-logs dev-host

help:
	@echo "Vita Family — Comandos disponíveis:"
	@echo "  make dev         - Roda TUDO em desenvolvimento via Docker (Web, API, Postgres, MinIO, ClamAV, Mailhog)"
	@echo "  make dev-down    - Pára o ambiente de desenvolvimento"
	@echo "  make dev-logs    - Acompanha logs do ambiente de desenvolvimento"
	@echo "  make prod        - Roda TUDO em produção via Docker (Web, API, Worker, Postgres, MinIO, ClamAV)"
	@echo "  make prod-down   - Pára o ambiente de produção"
	@echo "  make prod-logs   - Acompanha logs do ambiente de produção"
	@echo "  make dev-host    - Roda serviços no Docker e API/Web no host com hot-reload"
	@echo "  make up / down   - Inicia/pára apenas os serviços de apoio (BD/Storage/Mailhog)"
	@echo "  make migrate     - Aplica migrações na base de dados"
	@echo "  make test        - Corre os testes da API e Web"
	@echo "  make lint / fmt  - Linter e formatador de código"
	@echo "  make build       - Compila API e Web"

# --- AMBIENTE DE DESENVOLVIMENTO (DOCKER) ---
# Sobe a stack completa de desenvolvimento (Web em :8088, API em :8080, Mailhog em :8025, MinIO em :9001, Postgres em :5432)
dev:
	@echo "A iniciar Vita Family em modo DESENVOLVIMENTO via Docker..."
	$(DEV_COMPOSE) --profile apps up -d --build
	@echo ""
	@echo "Ambiente de desenvolvimento ativo:"
	@echo "  - Frontend PWA:    http://localhost:$${WEB_PORT:-8088}"
	@echo "  - API Backend:     http://localhost:$${API_PORT:-8080} (e via proxy em http://localhost:$${WEB_PORT:-8088}/api/v1)"
	@echo "  - Mailhog (Email): http://localhost:8025"
	@echo "  - MinIO Console:   http://localhost:9001"
	@echo "  - PostgreSQL:      127.0.0.1:5432"
	@echo ""
	@echo "Comandos úteis: make dev-logs | make dev-down"

dev-down:
	$(DEV_COMPOSE) down

dev-logs:
	$(DEV_COMPOSE) logs -f

# --- AMBIENTE DE PRODUÇÃO (DOCKER) ---
# Sobe a stack completa de produção (Web em :8088, API em :8080, Worker, MinIO, ClamAV, Postgres)
prod:
	@echo "A iniciar Vita Family em modo PRODUÇÃO via Docker..."
	$(PROD_COMPOSE) up -d --build
	@echo ""
	@echo "Ambiente de produção ativo:"
	@echo "  - Frontend PWA:  http://localhost:$${WEB_PORT:-8088}"
	@echo "  - API Backend:   http://localhost:$${API_PORT:-8080} (e via proxy em http://localhost:$${WEB_PORT:-8088}/api/v1)"
	@echo "  - MinIO Console: http://localhost:9001"
	@echo "  - PostgreSQL:    127.0.0.1:5432"
	@echo ""
	@echo "Comandos úteis: make prod-logs | make prod-down"

prod-down:
	$(PROD_COMPOSE) down

prod-logs:
	$(PROD_COMPOSE) logs -f

# --- DESENVOLVIMENTO NO HOST (COM HOT-RELOAD) ---
# Sobe serviços no Docker e corre API e Web diretamente no host
dev-host: up
	@if [ ! -f apps/api/.env ] && [ -f deploy/.env ]; then cp deploy/.env apps/api/.env; fi
	pnpm --filter @vitafamily/api run migrate
	pnpm --parallel --filter @vitafamily/api --filter vita-family-web run dev

install:
	pnpm install

# Contrato -> tipos: docs/05-api/openapi.yaml -> apps/api/src (openapi-typescript). Não editar o gerado.
gen:
	pnpm --filter @vitafamily/api run gen

test:
	pnpm --filter @vitafamily/api run test
	pnpm --filter vita-family-web run test

lint:
	pnpm --filter @vitafamily/api run lint
	pnpm --filter vita-family-web run typecheck

fmt:
	pnpm --filter @vitafamily/api run fmt

build:
	pnpm --filter @vitafamily/api run build
	pnpm --filter vita-family-web run build

# Aplica as migrações (runner próprio) à base do compose de desenvolvimento (precisa de `make up` e de deploy/.env).
migrate:
	@if [ ! -f apps/api/.env ] && [ -f deploy/.env ]; then cp deploy/.env apps/api/.env; fi
	pnpm --filter @vitafamily/api run migrate

image:
	docker build -t vitafamily/vita:dev -f $(API_DIR)/Dockerfile .

# Serviços de apoio para desenvolvimento
up:
	$(DEV_COMPOSE) up -d

down:
	$(DEV_COMPOSE) down

# Só o frontend (apps/web): build (com testes) e nginx em http://localhost:$${WEB_PORT:-8088}.
web-up:
	$(WEB_COMPOSE) up -d --build

web-down:
	$(WEB_COMPOSE) down

web-logs:
	$(WEB_COMPOSE) logs -f web
