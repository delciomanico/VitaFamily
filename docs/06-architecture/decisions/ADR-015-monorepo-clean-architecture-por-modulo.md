# ADR-015 — Monorepo e módulos em Clean Architecture (Node.js/TypeScript)

**Estado:** Aceite — decisão do proprietário (2026-10-08). Substitui ADR-013 (estrutura de pastas Go). Complementa ADR-014.

## Contexto
Com ADR-014 (Node.js/TypeScript, Clean Architecture), a estrutura de pastas definida em ADR-013 (específica de Go) deixa de se aplicar. É preciso uma estrutura equivalente que mantenha: um módulo = uma responsabilidade (`modules.md`), fronteiras entre camadas dentro do módulo (Clean Architecture) e fronteiras entre módulos (só pela API pública), sem fugas.

## Decisão
```text
vitafamily/
├── apps/
│   ├── api/                      # pacote pnpm @vitafamily/api
│   │   ├── src/
│   │   │   ├── main/             # composition root: entrypoints api|worker|migrate|create-platform-admin
│   │   │   ├── platform/         # kit técnico partilhado (config, clock, logger, ids, errors, http, db-pool);
│   │   │   │                     #   NUNCA importa módulos de negócio
│   │   │   └── modules/<m>/      # um por módulo de modules.md
│   │   │       ├── index.ts      # raiz = API pública do módulo (único ponto de import por outros módulos)
│   │   │       ├── domain/       # entidades + regras puras; só platform/clock (via porta) e platform/ids
│   │   │       ├── application/  # casos de uso; DEFINE as portas (interfaces) de que precisa; chama access/audit
│   │   │       ├── infrastructure/ # adaptadores que IMPLEMENTAM as portas (Kysely/pg, pg-boss, minio, mailer…)
│   │   │       └── interface/    # controllers HTTP (contrato gerado), mapeia erros de domínio -> Problem
│   │   ├── db/
│   │   │   ├── migrations/*.sql  # reaproveitadas de ADR-012, sem alteração de conteúdo
│   │   │   └── migrate-runner.ts # runner mínimo próprio (tabela de controlo + transação)
│   │   └── tests/architecture.*  # equivalente ao arch_test.go: verifica o grafo de import contra modules.md
│   └── web/                      # PWA (futuro)
├── deploy/                       # docker-compose, Caddy, .env.example
├── docs/                         # fonte da verdade; docs/05-api/openapi.yaml é o contrato único
├── pnpm-workspace.yaml
└── Makefile                      # orquestra pnpm (Node está no host; Docker só para serviços e imagem final)
```
**Camadas** (dependências só no sentido da seta): `interface → application → domain` e `infrastructure → application`(implementa portas) `→ domain`; a **raiz** (`index.ts`) liga as camadas e é o único ficheiro importável por outros módulos.
- `domain`: regras puras, sem I/O, sem framework; só tipos/ports próprios.
- `application`: casos de uso; define as **portas** (interfaces TypeScript) que a `infrastructure` implementa; chama `access` e `audit` só pela raiz desses módulos.
- `infrastructure`: implementa as portas (Kysely/`pg`, `minio`, `pg-boss`, Nodemailer, `web-push`, cliente clamd); é a **única** camada que importa bibliotecas externas de I/O.
- `interface`: controllers HTTP ligados ao contrato gerado de `openapi.yaml`; único (com a raiz) que usa validação HTTP e DTOs/Zod; traduz erros de domínio em `Problem`.

**Fronteiras entre módulos:** cada módulo só é importado pela sua raiz (`modules/<m>/index.ts`); um teste de arquitetura (`tests/architecture.*`, baseado no grafo de imports) verifica as dependências declaradas em `modules.md`, a ausência de ciclos, que `admin` não importa módulos de saúde, e que a árvore em disco coincide com a declarada — equivalente funcional ao `internal/arch_test.go` do ADR-013.

**Composição HTTP:** o `main/api.ts` (composition root) monta o `HttpServer` (Express) e liga o controller de `interface` de cada módulo às rotas geradas a partir de `openapi.yaml`. Ligar um módulo novo = 1 import no composition root + 1 registo de rotas.

## Alternativas
Manter a estrutura Go de ADR-013 traduzida 1:1 (pastas `domain/service/repo/handler`) — rejeitado: "service"/"repo"/"handler" não nomeiam as camadas de Clean Architecture (`application`/`infrastructure`/`interface`) nem tornam explícita a regra de dependência (portas definidas pela `application`, implementadas pela `infrastructure`), que é o ponto central do pedido do proprietário (substituir ferramentas sem tocar nas regras). Pastas técnicas globais (`controllers/`, `services/`, `repositories/` na raiz da app) — agrupam por técnica, não por módulo; quebrariam o isolamento por domínio.

## Consequências
- Todos os caminhos de código nos documentos passam a ser relativos a `apps/api/src` (ex.: `platform` = `apps/api/src/platform`).
- Cada módulo novo ou alteração de dependências obriga a atualizar `modules.md` **e** o teste de arquitetura (falha se divergirem) — igual ao princípio de ADR-013.
- Módulos sem alguma camada (ex.: `audit` sem `interface`, `reports`/`admin` sem `domain`/`infrastructure` próprios) omitem essas pastas.
- `db/migrations/0001_extensions_and_enums.sql` (já commitada) é reaproveitada sem alteração; só o runner que a aplica muda de goose para o runner próprio em TypeScript. `0002_identity.sql` (users/auth/sessions/audit_logs), nunca commitada, foi perdida na limpeza do código Go e será reescrita de novo em M1 a partir de `docs/07-database/schema.md`.
