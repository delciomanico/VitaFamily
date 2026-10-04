# Vita Family — Makefile do monorepo. Go não está instalado no host: tudo corre em Docker.
# Raiz do repo montada em /src; os alvos Go correm em /src/apps/api. Caches fora do projeto (GO_CACHE).
GO_IMAGE   ?= golang:1.27-alpine
SQLC_IMAGE ?= sqlc/sqlc:1.31.1
GO_CACHE   ?= /tmp/vita-go-cache
API_DIR    := apps/api
COMPOSE    ?= docker compose -p vitafamily -f deploy/docker-compose.dev.yml
ROOT       := $(CURDIR)

DOCKER_GO = docker run --rm -v $(ROOT):/src -w /src/$(API_DIR) \
	-v $(GO_CACHE)/mod:/go/pkg/mod -v $(GO_CACHE)/build:/gocache \
	-e GOCACHE=/gocache -e GOFLAGS=-buildvcs=false -e HOME=/tmp -e CGO_ENABLED=0
GO = $(DOCKER_GO) $(GO_IMAGE)

.PHONY: help cache gen test lint fmt tidy build migrate image up down

help:
	@echo "make gen|test|lint|fmt|tidy|build|migrate|image|up|down   (API em $(API_DIR))"

cache:
	@mkdir -p $(GO_CACHE)/mod $(GO_CACHE)/build

# Contratos -> código: docs/05-api/openapi.yaml -> internal/api/gen; SQL -> internal/db/sqlcgen. Não editar o gerado.
gen: cache
	$(GO) go tool oapi-codegen -config oapi-codegen.yaml ../../docs/05-api/openapi.yaml
	$(GO) sh internal/api/gen_unimplemented.sh
	docker run --rm -v $(ROOT):/src -w /src/$(API_DIR) $(SQLC_IMAGE) generate
	$(GO) gofmt -w internal/api internal/db

test: cache
	$(GO) go test ./...

lint: cache
	@out="$$($(GO) gofmt -l cmd internal db)"; if [ -n "$$out" ]; then echo "gofmt necessário em:"; echo "$$out"; exit 1; fi
	$(GO) go vet ./...
	$(GO) go tool staticcheck ./...

fmt: cache
	$(GO) gofmt -w cmd internal db

tidy: cache
	$(GO) go mod tidy

build: cache
	$(GO) go build -trimpath -ldflags="-s -w" -o bin/vita ./cmd/vita

# Aplica migrações (goose + river) à base do compose de desenvolvimento (precisa de `make up` e de deploy/.env).
migrate: cache
	$(DOCKER_GO) --network vitafamily_default --env-file deploy/.env \
		-e DATABASE_URL="postgres://$${POSTGRES_USER:-vita}:$$(. ./deploy/.env; echo $$POSTGRES_PASSWORD)@postgres:5432/$${POSTGRES_DB:-vita}?sslmode=disable" \
		$(GO_IMAGE) go run ./cmd/vita migrate

image:
	docker build -t vitafamily/vita:dev $(API_DIR)

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down
