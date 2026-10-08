# Vita Family — Makefile do monorepo (ADR-014/ADR-015: Node.js/TypeScript).
# Node e pnpm estão instalados no host: os alvos correm diretamente, sem wrapper Docker.
# Docker só é usado para os serviços de apoio (Postgres/MinIO/ClamAV/Mailhog) e para a imagem final.
API_DIR := apps/api
COMPOSE ?= docker compose -p vitafamily -f deploy/docker-compose.dev.yml

.PHONY: help install gen test lint fmt build migrate image up down

help:
	@echo "make install|gen|test|lint|fmt|build|migrate|image|up|down   (API em $(API_DIR))"

install:
	pnpm install

# Contrato -> tipos: docs/05-api/openapi.yaml -> apps/api/src (openapi-typescript). Não editar o gerado.
gen:
	pnpm --filter @vitafamily/api run gen

test:
	pnpm --filter @vitafamily/api run test

lint:
	pnpm --filter @vitafamily/api run lint

fmt:
	pnpm --filter @vitafamily/api run fmt

build:
	pnpm --filter @vitafamily/api run build

# Aplica as migrações (runner próprio) à base do compose de desenvolvimento (precisa de `make up` e de deploy/.env).
migrate:
	pnpm --filter @vitafamily/api run migrate

image:
	docker build -t vitafamily/vita:dev $(API_DIR)

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down
