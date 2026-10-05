# ADR-012 — Stack em Go, alojamento em VPS própria e domínio

**Estado:** Aceite — decisão **do proprietário** (2026-10-04). Substitui ADR-003 e parte de ADR-002 e ADR-004. A linha “Alojamento” (Caddy) foi substituída por **ADR-014** (Dokploy).

## Contexto
O proprietário decidiu implementar em **Go**, com estrutura simples e reutilizável, alojar na **sua VPS**, no domínio **vitafamily.cassfrei.com**; a entidade responsável pelo tratamento é **Cassfrei**. Quer minimizar consumo de recursos (tokens) e dividir o trabalho por agentes especializados.

## Decisão
| Tema | Escolha |
|---|---|
| Linguagem / runtime | **Go** (versão estável atual), **um único binário** `vita` com subcomandos: `api`, `worker`, `migrate`, `create-platform-admin`. |
| Arquitetura | Mantém-se o **monólito modular** (ADR-002): um pacote por módulo em `internal/`, fronteiras por interface. |
| HTTP | `net/http` + **chi**. Contrato primeiro: **oapi-codegen** gera interfaces e tipos a partir de `docs/05-api/openapi.yaml` (strict server); validação de pedidos com o validador OpenAPI. |
| Base de dados | PostgreSQL 16 com **pgx** e **sqlc** (SQL tipado). Migrações em SQL com **goose**. Substitui Prisma: constraints avançadas (FKs compostas, índices parciais, CHECK) escrevem-se **diretamente em SQL**, sem camada extra (resolve a fricção do ADR-003). |
| Filas e agendamento | **river** (fila em PostgreSQL). **Sem Redis no MVP**: a BD é a fonte da verdade (ADR-004) e o scanner já lê a BD; menos um serviço na VPS. |
| Rate limiting | Em memória (limitador por chave) numa única instância da API; falha fechada nos endpoints de autenticação. Se um dia houver >1 instância, passar para armazenamento partilhado (novo ADR). |
| Autenticação | `golang-jwt/jwt` (access token) + **argon2id** (`x/crypto`); refresh rotativo em BD (ADR-007 mantém-se). |
| Armazenamento | **MinIO** (S3) em contentor na VPS via `minio-go`, atrás de interface `Storage` (trocável por S3 UE). |
| Antivírus | ClamAV (contentor) via cliente clamd. |
| E-mail / Push | SMTP (`go-mail`) e Web Push (`webpush-go`). |
| Observabilidade | `log/slog` (JSON), `prometheus/client_golang`. |
| Testes | `testing` da stdlib + **testcontainers-go** (PostgreSQL e MinIO reais); relógio injetável (`Clock`). |
| Alojamento | **VPS do proprietário**, Docker Compose, **Caddy** como proxy reverso com TLS automático. |
| Domínio | **`https://vitafamily.cassfrei.com`**: PWA na raiz e API em **`/api/v1`** (mesma origem ⇒ cookies `SameSite=Strict` e CORS triviais). |
| Responsável pelo tratamento | **Cassfrei** (preenche a pendência de `privacy.md`). |

## Alternativas
Manter NestJS/Prisma (rejeitado pelo proprietário); Go com ORM (GORM/ent): mais magia e pior controlo de constraints; Go com Redis+asynq: mais um serviço sem necessidade real na escala N9.

## Justificação
Go dá um binário único, baixo consumo e arranque rápido (bom para uma VPS); sqlc + SQL manual alinha-se ao desenho do esquema já documentado; contrato primeiro com oapi-codegen impede divergência entre código e `openapi.yaml` (prompt §29).

## Consequências
- ADR-002 mantém o **monólito modular**, mas deixa de mencionar NestJS; **ADR-003** (Prisma) e **ADR-004** (Redis/BullMQ) ficam substituídos nos pontos acima.
- Todos os documentos que citam NestJS/Prisma/Redis/BullMQ/Jest devem ser lidos com esta tabela por cima; `docs/11-implementation/conventions.md` descreve a estrutura Go.
- **Residência na UE (N5):** a VPS **tem de estar na UE** e os backups também; **a confirmar pelo proprietário** (ver `infrastructure.md`). Backups fora da própria VPS são obrigatórios (RPO/RTO).
- Uma única VPS é um ponto único de falha: o SLO de 99,5 % depende do fornecedor; aceite pelo proprietário.
- Sem ferramentas Go instaladas localmente: compilar e testar em contentores Docker (`golang`).
