# ADR-014 — Stack em Node.js/TypeScript com Clean Architecture (Ports & Adapters)

**Estado:** Aceite — decisão **do proprietário** (2026-10-08). Substitui ADR-012 (linguagem, acesso a dados, filas, testes); restaura o monólito modular de ADR-002 mas sem NestJS; substitui ADR-003 (sem Prisma). Alojamento, domínio e armazenamento de objetos de ADR-012 mantêm-se (não eram específicos de Go).

## Contexto
O proprietário reconsiderou a decisão de ADR-012: a implementação em Go foi um erro de direção — o plano original (`11-implementation/plan.md` §7.3) já previa Node LTS + pnpm. Quer o backend em **Node.js/TypeScript**, com **Clean Architecture** explícita para que ferramentas externas (framework HTTP, acesso a dados, fila, etc.) sejam **substituíveis sem tocar nas regras de negócio**. Nesta data, M0 (fundações) e M1 (auditoria/users/auth) já estavam implementados em Go; ficam descartados (decisão do proprietário) e reescritos em Node.js seguindo o mesmo plano de milestones.

## Decisão
| Tema | Escolha |
|---|---|
| Linguagem / runtime | **Node.js 24 LTS** + **TypeScript** (modo `strict`). Monorepo com **pnpm workspaces** (`apps/api`, `apps/web` futuro). |
| Arquitetura interna de cada módulo | **Clean Architecture / Ports & Adapters**: `domain` (entidades e regras puras, zero dependências externas) → `application` (casos de uso; define as **portas**/interfaces de que precisa) → `infrastructure` (adaptadores que implementam as portas: BD, fila, e-mail, storage — **substituíveis**) → `interface` (controllers HTTP, DTOs). Dependências só apontam para dentro (`interface`/`infrastructure` → `application` → `domain`); nunca o inverso. |
| HTTP | **Express**, isolado atrás de uma porta `HttpServer`; contrato primeiro mantém-se: **express-openapi-validator** valida pedidos/respostas contra `docs/05-api/openapi.yaml`; tipos gerados com **openapi-typescript**. Fastify é a alternativa documentada caso o Express se revele insuficiente (troca confinada à camada `interface`). |
| Base de dados | PostgreSQL 16 com **node-postgres (`pg`)** + **Kysely** (query builder tipado, SQL quase puro, sem geração de código nem *magia* de ORM) atrás de interfaces `Repository` por módulo — só a `infrastructure` de cada módulo importa Kysely/`pg`. Migrações em **SQL simples e numerado** (reaproveita `db/migrations/*.sql` tal como estão), aplicadas por um **runner mínimo próprio** (tabela de controlo + transação, equivalente ao goose do ADR-012) para não acoplar a uma ferramenta externa de migrações. |
| Filas e agendamento | **pg-boss** (fila sobre PostgreSQL). **Sem Redis** (mantém ADR-004): a BD continua a ser a fonte da verdade. |
| Rate limiting | Em memória (limitador por chave) numa única instância da API; falha fechada nos endpoints de autenticação — igual a ADR-012. |
| Autenticação | **`jose`** (JWT, access token) + **`argon2`** (bindings nativos ao Argon2 de referência — mesmos parâmetros do ADR-007); tokens de refresh opacos via `node:crypto` (`randomBytes`), sem dependência externa. |
| Armazenamento | **MinIO** (S3) via SDK `minio`, atrás de interface `Storage` (trocável por S3 UE) — decisão de ADR-012 mantida (não é específica de linguagem). |
| Antivírus | ClamAV (contentor) via cliente `clamd` para Node, atrás de uma porta `VirusScanner` — mantido. |
| E-mail / Push | **Nodemailer** (SMTP) e **`web-push`**, atrás de portas `Mailer`/`PushSender`. |
| Observabilidade | **pino** (logs JSON, com redação de campos marcados — equivalente ao `logx`) + **prom-client** (métricas Prometheus). |
| Validação de fronteira | **Zod** nos DTOs da camada `interface` (schemas puros, sem acoplamento a um framework). |
| Testes | **Vitest** (regras de domínio, tabela de casos) + **testcontainers** (Node; PostgreSQL e MinIO reais) + **Supertest** (API); relógio injetável (`Clock` port, igual ao conceito de ADR-010). |
| Fronteiras entre camadas/módulos | Teste de arquitetura próprio (import graph, ex.: via `dependency-cruiser` como *dev dependency* de lint, não runtime) equivalente ao `arch_test.go` do ADR-013; falha o CI se o código divergir de `modules.md`. |
| Alojamento | **VPS do proprietário**, Docker Compose, **Caddy** com TLS automático — inalterado (ADR-012). |
| Domínio | `https://vitafamily.cassfrei.com`, API em `/api/v1` — inalterado (ADR-012). |

## Alternativas
Manter Go (rejeitado pelo proprietário — decisão revertida); NestJS (rejeitado: DI e módulos do framework tornam as fronteiras menos explícitas e mais difíceis de substituir, contra o objetivo de "trocar ferramentas sempre que possível"); Prisma (rejeitado: acopla o domínio ao cliente gerado e dificulta substituição do motor de acesso a dados); Fastify em vez de Express (fica como alternativa aceite, não escolha inicial); BullMQ/Redis para filas (rejeitado: mantém ADR-004, sem serviço adicional).

## Justificação
Node.js/TypeScript está instalado e disponível no host (sem a fricção de build 100% em contentores que o Go exigia), reduz a curva para o proprietário e cumpre o pedido explícito de **Clean Architecture com independência de ferramentas**: cada porta (`Repository`, `Storage`, `Mailer`, `PushSender`, `VirusScanner`, `Clock`, `Queue`) tem exatamente um adaptador de produção e pode ganhar um segundo sem alterar `domain`/`application`. Kysely e pg-boss evitam dependências pesadas (ORM completo, Redis) mantendo tipagem e simplicidade, no mesmo espírito de sqlc/river do ADR-012.

## Consequências
- Todo o código Go de `apps/api` (M0 e M1) é removido; `docs/05-api/openapi.yaml` é reaproveitado sem alteração (contrato independente de linguagem). `db/migrations/0001_extensions_and_enums.sql` (commitada) é reaproveitada sem alteração; `0002_identity.sql` (nunca commitada) foi perdida na limpeza e é reescrita em M1 a partir de `docs/07-database/schema.md`.
- `ADR-013`, `docs/11-implementation/conventions.md` e qualquer documento com estrutura de pastas Go (`internal/`, `cmd/vita`, `.go`) ficam substituídos por `ADR-015` e pela nova `conventions.md` (Node/TypeScript).
- Documentos que ainda mencionam NestJS/Prisma/Redis/BullMQ/Jest/Go devem ler esta tabela por cima (mesma regra de leitura que ADR-012 introduziu, agora invertida).
- O plano de milestones (`plan.md`) e a lista de responsabilidades por módulo (`modules.md`) não mudam de conteúdo de negócio — só a tecnologia subjacente.
- Reescrever M0 e M1 em Node.js/TypeScript é o próximo trabalho de implementação (sem alterar âmbito funcional já definido).
