# Vita Family — Convenções de código Node.js/TypeScript (Fase 17)

> Estado: v0.3 (ADR-014, ADR-015, ADR-016 — substituem a v0.1 em Go). Objetivo: **código simples, reutilizável e barato de manter**, com **Clean Architecture** para que qualquer ferramenta externa (framework HTTP, acesso a dados, fila, storage…) seja substituível sem tocar nas regras de negócio. Quem escreve código lê **este ficheiro** e só os documentos do seu módulo (ver `CLAUDE.md`).
> As 4 camadas por módulo (§1) são o **máximo** disponível, não um mínimo obrigatório: criar só as portas e pastas que o critério do ADR-016 (§3.2) justifica.

## 1. Estrutura (monorepo — ADR-015; caminhos de código relativos a `apps/api`)
```text
vitafamily/  apps/api  apps/web(futuro)  deploy/  docs/  pnpm-workspace.yaml  Makefile
apps/api/
  src/
    main/                      # composition root (liga tudo à mão): api | worker | migrate | create-platform-admin
    platform/                  # REUTILIZÁVEL: config, clock (porta), logger, ids, errors, http, db-pool (nada de negócio)
    modules/<m>/                # um por módulo (modules.md)
      README.md                 # mapa curto do módulo: o que faz + fluxo de um pedido típico ficheiro a ficheiro (ADR-016)
      index.ts                  # raiz: API pública do módulo + ligação das camadas (único ficheiro importável por outros módulos)
      domain/                   # entidades + regras puras + testes (sem I/O, sem framework)
      application/              # casos de uso + PORTAS (interfaces, só onde o critério do ADR-016 se aplica) + testes
      infrastructure/           # Kysely/pg, pg-boss, minio, mailer…: IMPLEMENTA as portas (só se o módulo tiver alguma)
      interface/                # controllers HTTP ligados ao contrato gerado; erros de domínio -> Problem
      # qualquer uma destas pastas que fique sem conteúdo real não se cria (ADR-016) — as 4 camadas são o máximo, não o mínimo
  db/
    migrations/*.sql            # SQL simples e numerado (reaproveitado de ADR-012); constraints avançadas aqui
    migrate-runner.ts           # runner mínimo próprio (tabela de controlo + transação)
  tests/architecture.*          # equivalente ao arch_test.go: grafo de imports vs. modules.md
```
**Fluxo:** `interface → application → domain`; `infrastructure → application`(implementa as portas) `→ domain`; a raiz (`index.ts`) liga tudo.
**Novo módulo ligado à API:** 1 import no composition root (`main/api.ts`) + registo das rotas do módulo.
**Outro módulo:** só pela raiz do pacote (`modules/<m>/index.ts`), e só a partir da `application`; dependências declaradas em `modules.md` §2 e verificadas pelo teste de arquitetura (falha se a doc/árvore divergirem).
Comandos na raiz do repo: `pnpm gen | test | lint | build | migrate | up | down` (Node/pnpm no host; Docker só para Postgres/MinIO/ClamAV/Mailhog e para a imagem final).

## 2. Regras de reutilização (não duplicar)
| Preciso de… | Usar |
|---|---|
| Transação | `withTransaction(pool, async (tx) => {...})` — todos os casos de uso que escrevem mais de uma tabela |
| Erro HTTP | **interface**: `toProblem(error)` (códigos de `errors.md`), traduzindo os erros de domínio por tipo/`instanceof`; `domain`/`application`/`infrastructure` devolvem erros de domínio e **não** importam nada de HTTP; **nunca** responder sem passar por `toProblem` |
| Utilizador/família do pedido | `getActor(ctx)` (preenchido pelo middleware de auth + membership) |
| Autorização | **Só** `AccessPolicy.can(...)` (módulo `access`) — proibido ifs de permissão fora dele |
| Auditoria | `audit.record(tx, event)` na mesma transação |
| Hora | porta `Clock` injetada — **nunca** `new Date()`/`Date.now()` em código de negócio |
| Paginação | tipo `Page<T>` (limit/cursor) partilhado em `platform` |
| Ficheiros | porta `Storage` (implementada por adaptador `minio` em `infrastructure`) |
| E-mail / push | portas `Mailer`, `PushSender` |
| Jobs | `pg-boss` — handlers idempotentes, só chamados pela `infrastructure` do módulo dono |
| IDs | `newId()` (UUID v4, `node:crypto.randomUUID`) |

## 3. Regras de estilo
1. **Pequeno e explícito:** funções curtas, sem frameworks de DI (construtores/*factory functions* `createX(deps)` e ligação manual no composition root), sem decorators de DI, sem `any`.
2. **Portas (interfaces TypeScript) só quando o ADR-016 justifica** — ferramenta externa real e substituível, 2.º consumidor/implementação, ou necessidade de injetar para testar sem I/O (`Clock`, `Storage`, `Mailer`, `Repository`); definidas na `application`, implementadas na `infrastructure`. **Não criar porta** para bibliotecas de computação pura sem I/O que não vamos trocar (`argon2`, `jose`, `node:crypto` — chamam-se diretamente do `domain`; a proibição de I/O em `domain`/`application` do §3.9 já as protege) nem para casos de uso triviais de uma operação sem `infrastructure` própria — exemplos em ADR-016.
3. Dependências entre módulos só as de `modules.md` §3; `admin` **nunca** importa módulos de saúde. Teste de arquitetura em `tests/architecture.*`.
4. Repositórios **exigem `familyId`**; não existe consulta "por id" sem família.
5. Erros: devolver tipos de erro de domínio próprios (`NotFoundError`, `LastAdminError`…); traduzidos para `Problem` numa única função em `platform`.
6. Comentários só para o **porquê** (regras de negócio: citar `BR-xxx`/`FR-xxx`). Nomes em inglês; mensagens ao utilizador em pt-PT.
7. Sem dados de saúde em logs, erros ou notificações (logger com redação de campos marcados — `pino` `redact`).
8. SQL: sempre parametrizado (Kysely/`pg`, nunca concatenar strings). Migrações pequenas; constraints do `schema.md` implementadas **todas**.
9. TypeScript em modo `strict`; `domain` e `application` não importam bibliotecas de I/O (Express, Kysely, pg-boss, minio, nodemailer…) — só `infrastructure`/`interface` o fazem.

## 4. Testes
- Tabela de casos (`it.each`), regras puras sem I/O em `domain`/`application`; integração com **testcontainers** (PostgreSQL e MinIO reais); API com **Supertest**.
- A matriz de autorização é **dados** (`access/*.matrix.test.ts` gera casos de `authorization.md` §3).
- Cada PR liga-se a `FR-*`/`BR-*`/`AC-*`. Funcionalidade sem critérios de aceitação não entra.
- Executar localmente: `pnpm test` (Node/pnpm no host; não precisa de Docker exceto para testcontainers).

## 5. Ordem de trabalho (plano M0–M10 em `plan.md`)
Contrato (`openapi.yaml`) → migração SQL → portas + testes de domínio → casos de uso (`application`) → adaptadores (`infrastructure`) → controllers (`interface`) → testes de API → auditoria → critérios de aceitação → `README.md` do módulo (ADR-016).

## 6. Economia de tokens (regras para agentes)
1. **Ler só o necessário:** `CLAUDE.md` + `conventions.md` + docs listados no agente. Não reler `docs/` inteiro.
2. Usar `Grep`/`Read` com `offset/limit`; não colar ficheiros grandes em respostas.
3. Reutilizar `src/platform` e geradores (`openapi-typescript`, tipos do Kysely) em vez de escrever à mão.
4. Reportar de forma curta: ficheiros alterados, testes executados, bloqueios. Sem repetir a especificação.
5. Divergência com a documentação ⇒ **parar e reportar** (não improvisar, prompt §29).
