# Vita Family — Convenções de código Go (Fase 17)

> Estado: v0.1 (ADR-012). Objetivo: **código simples, reutilizável e barato de manter**. Quem escreve código lê **este ficheiro** e só os documentos do seu módulo (ver `CLAUDE.md`).

## 1. Estrutura (monorepo — ADR-013; caminhos de código relativos a `apps/api`)
```text
vitafamily/  apps/api  apps/web(futuro)  deploy/  docs/  Makefile
apps/api/
  cmd/vita/main.go           # composition root (liga tudo à mão): api | worker | migrate | create-platform-admin
  db/migrations/*.sql        # goose; constraints avançadas aqui
  db/queries/<modulo>.sql    # sqlc
  internal/
    platform/                # REUTILIZÁVEL: config clock db httpx logx storage mail push ids jobs (nada de negócio)
    api/                     # router + Server (compõe handlers) + gen/ (GERADO do openapi.yaml, não editar)
    db/sqlcgen/              # GERADO pelo sqlc, não editar
    modules/<m>/             # um por módulo (modules.md)
      <m>.go                 # raiz: API pública do módulo + ligação das camadas (+ alias `type HTTP = handler.Handler`)
      internal/domain/       # regras puras + testes (sem I/O)
      internal/service/      # casos de uso + portas (interfaces) + testes
      internal/repo/         # sqlc/pgx: implementa as portas
      internal/handler/      # implementa os métodos do contrato gerado; erros de domínio -> Problem
```
**Fluxo:** `handler → service → domain`; `repo → domain` (implementa as portas definidas no service); a raiz liga tudo.
**Novo módulo ligado à API:** 1 campo embutido em `api.Server`, 1 em `api.Deps`, construção em `cmd/vita/api.go`.
**Outro módulo:** só pela raiz do pacote, e só a partir do `service`; dependências declaradas em `modules.md` §2 e `internal/arch_test.go` (o teste falha se a doc/árvore divergirem).
Comandos na raiz do repo: `make gen | test | lint | build | migrate | up | down`.

## 2. Regras de reutilização (não duplicar)
| Preciso de… | Usar |
|---|---|
| Transação | `db.InTx(ctx, pool, func(tx) error)` — todos os casos de uso que escrevem mais de uma tabela |
| Erro HTTP | **handler**: `httpx.Problem(code)` (códigos de `errors.md`), traduzindo os erros de domínio com `errors.Is`; domain/service/repo devolvem erros de domínio e **não** importam `httpx`; **nunca** `http.Error` solto |
| Utilizador/família do pedido | `httpx.Actor(ctx)` (preenchido pelo middleware de auth + membership) |
| Autorização | **Só** `access.Policy.Can(...)` (módulo `access`) — proibido ifs de permissão fora dele |
| Auditoria | `audit.Record(ctx, tx, Event{...})` na mesma transação |
| Hora | `clock.Clock` injetado — **nunca** `time.Now()` em código de negócio |
| Paginação | `httpx.Page` (limit/cursor) |
| Ficheiros | interface `storage.Storage` |
| E-mail / push | `mail.Mailer`, `push.Sender` (atrás de interfaces) |
| Jobs | `jobs` (river) — handlers idempotentes |
| IDs | `ids.New()` (UUID v4) |

## 3. Regras de estilo
1. **Pequeno e explícito:** funções curtas, sem frameworks de DI (construtores `NewX(deps)` e ligação manual em `cmd/vita`), sem reflexão, sem generics desnecessários.
2. Interfaces **onde há 2º consumidor ou para testar** (Clock, Storage, Mailer); não criar interfaces por defeito.
3. Dependências entre módulos só as de `modules.md` §3; `admin` **nunca** importa módulos de saúde. Teste de arquitetura em `internal/arch_test.go`.
4. Repositórios **exigem `familyID`**; não existe consulta "por id" sem família.
5. Erros: devolver; `errors.Is/As` com erros de domínio (`ErrNotFound`, `ErrLastAdmin`…) traduzidos para `Problem` numa única função em `httpx`.
6. Comentários só para o **porquê** (regras de negócio: citar `BR-xxx`/`FR-xxx`). Nomes em inglês; mensagens ao utilizador em pt-PT.
7. Sem dados de saúde em logs, erros ou notificações (`logx` redige campos marcados).
8. SQL: sempre parametrizado (sqlc). Migrações pequenas; constraints do `schema.md` implementadas **todas**.

## 4. Testes
- Tabela de casos (`table-driven`), regras puras sem I/O; integração com **testcontainers-go** (PostgreSQL real); API com `httptest`.
- A matriz de autorização é **dados** (`access/matrix_test.go` gera casos de `authorization.md` §3).
- Cada PR liga-se a `FR-*`/`BR-*`/`AC-*`. Funcionalidade sem critérios de aceitação não entra.
- Executar via Docker (Go não está instalado no host): `make test` = `docker run golang … go test ./...`.

## 5. Ordem de trabalho (plano M0–M10 em `plan.md`)
Contrato (`openapi.yaml`) → migração SQL → queries sqlc → regras de domínio + testes → service → handler → testes de API → auditoria → critérios de aceitação.

## 6. Economia de tokens (regras para agentes)
1. **Ler só o necessário:** `CLAUDE.md` + `conventions.md` + docs listados no agente. Não reler `docs/` inteiro.
2. Usar `Grep`/`Read` com `offset/limit`; não colar ficheiros grandes em respostas.
3. Reutilizar `internal/platform` e geradores (`sqlc`, `oapi-codegen`) em vez de escrever à mão.
4. Reportar de forma curta: ficheiros alterados, testes executados, bloqueios. Sem repetir a especificação.
5. Divergência com a documentação ⇒ **parar e reportar** (não improvisar, prompt §29).
