# ADR-013 — Monorepo e módulos em camadas

**Estado:** **Substituída por ADR-015** (2026-10-08): a estrutura de pastas é específica de Go (`internal/`, `cmd/vita`, camadas `domain/service/repo/handler`); ADR-015 define o equivalente em Node.js/TypeScript com Clean Architecture (`domain/application/infrastructure/interface`). O princípio de módulo único com fronteiras verificadas por teste de arquitetura mantém-se.

## Contexto
O repositório é um monorepo (API agora; PWA, infraestrutura e documentação no mesmo repositório). A API deve ser modular **e** em camadas, sem fugas de fronteiras.

## Decisão
```text
vitafamily/
├── apps/api/            # módulo Go (github.com/cassfrei/vitafamily/apps/api)
│   ├── cmd/vita/        # composition root: api | worker | migrate | create-platform-admin
│   ├── db/              # migrations/*.sql (goose), queries/*.sql (sqlc)
│   └── internal/
│       ├── platform/    # kit técnico partilhado; nunca importa módulos
│       ├── api/         # montagem HTTP: router + contrato gerado (api/gen) + Server por composição
│       ├── db/sqlcgen/  # código sqlc gerado
│       └── modules/<m>/ # UM por módulo de modules.md
│           ├── <m>.go                # raiz = API pública do módulo + ligação das camadas
│           └── internal/{domain,service,repo,handler}
├── apps/web/            # PWA (futuro)
├── deploy/              # docker-compose, Caddy, .env.example
├── docs/                # fonte da verdade; docs/05-api/openapi.yaml é o contrato único
└── Makefile             # orquestra tudo (Docker; Go não está no host)
```
**Camadas** (dependências só no sentido da seta): `handler → service → domain` e `repo → domain`; a **raiz** liga as camadas.
- `domain`: regras puras, só `platform/ids` e `platform/clock`.
- `service`: casos de uso; define as **portas** (interfaces) de que precisa; chama `access` e `audit`; outros módulos só pela raiz.
- `repo`: implementa as portas com sqlc/pgx; único que importa `db/sqlcgen`.
- `handler`: implementa os métodos do contrato gerado; único (com a raiz) que usa `platform/httpx` e `api/gen`; traduz erros de domínio em `Problem`.

**Fronteiras entre módulos:** o diretório `internal/` de cada módulo faz o **compilador** impedir imports de camadas alheias; `internal/arch_test.go` verifica ainda as dependências declaradas (`modules.md`), a ausência de ciclos, que `admin` não importa saúde e que a árvore em disco coincide com a declarada.

**Composição HTTP:** `api.Server` embute o handler de cada módulo (alias exportado na raiz, ex.: `users.HTTP`) e, um nível mais fundo, `Unimplemented` (501). Ligar um módulo = 1 campo em `Server`, 1 em `Deps`, 1 construção.

## Alternativas
Pacotes planos por módulo (menos fronteiras, mais acoplamento); camadas globais (`controllers/`, `services/`, `repositories/`) — agrupam por técnica e não por domínio, e quebram o isolamento por módulo; `go.work` com vários módulos Go — complexidade sem ganho com uma só app Go.

## Consequências
- Todos os caminhos de código nos documentos são relativos a `apps/api` (ex.: `internal/platform` = `apps/api/internal/platform`).
- Cada módulo novo ou alteração de dependências obriga a atualizar `modules.md` **e** `arch_test.go` (o teste falha se divergirem).
- Os módulos sem camada própria (ex.: `audit` sem handler, `reports`/`admin` sem domain/repo) omitem essas pastas.
