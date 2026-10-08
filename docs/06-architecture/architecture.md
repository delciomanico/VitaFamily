# Vita Family — Arquitetura (Fase 11)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture: `domain/application/infrastructure/interface`), Express+express-openapi-validator, Kysely+`pg`, pg-boss, **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ, Jest ou Go, ler o equivalente de ADR-014/ADR-015; a arquitetura lógica mantém-se.

> Estado: **v0.1 — decisões adotadas com a recomendação do assistente (delegação do proprietário, 2026-10-04); ver ADRs em `decisions/`.**
> Princípios (prompt §27): *Simple first · Modular · Extensible · Testable · Secure*.

## 1. Resumo da decisão

**Monólito modular** em NestJS/TypeScript, com PostgreSQL, Redis (filas e rate limit) e armazenamento de objetos S3-compatível. **Um** código-base, **dois processos** (API e worker), sem microserviços.

### Porquê monólito modular e não microserviços (para aprender)
- **Problema:** queremos separação de responsabilidades sem pagar a complexidade operacional de sistemas distribuídos.
- **Alternativas:** (a) monólito "em camadas" sem fronteiras: rápido, mas degrada; (b) microserviços: isolamento forte, mas rede, consistência distribuída, deploys e observabilidade multiplicam o custo, injustificado para 1 000 famílias (N9); (c) **monólito modular**: um deploy, fronteiras internas explícitas.
- **Escolha:** (c). As fronteiras são módulos Nest com API interna explícita; se um dia um módulo (ex.: notificações) precisar de escalar sozinho, extrai-se sem reescrever.
- **Impacto futuro:** a regra "um módulo só fala com outro através da sua API pública" é o que mantém essa porta aberta; é verificada por lint/testes de arquitetura.

## 2. Visão de componentes

```text
 PWA (cliente) ──HTTPS──▶ Reverse proxy (TLS) ──▶ API (NestJS)
                                                   │  controllers → application services → domain/policies
                                                   │  repositories (Prisma)
                                  ┌────────────────┼───────────────────┐
                                  ▼                ▼                   ▼
                            PostgreSQL           Redis            Object storage
                         (dados, filas de      (BullMQ, rate       (MinIO/S3-EU:
                          estado, auditoria)    limit, cache)       documentos, exports)
                                  ▲                ▲                   ▲
                                  └────────────── Worker (NestJS, mesmo código) ──┐
                                      jobs: tomas, alertas, notificações,          │
                                      antivírus, exportações, ciclo de vida        ▼
                                                              ClamAV · SMTP e-mail · Web Push
```

- **API:** pedidos HTTP síncronos. Nunca envia e-mail/push nem analisa ficheiros no pedido.
- **Worker:** consome filas BullMQ e corre tarefas agendadas (relógio injetável para testes).
- **PostgreSQL:** fonte da verdade. Os jobs periódicos leem estado da BD (não dependem de Redis para perder dados): se o Redis falhar, os jobs repõem-se a partir da BD (ver ADR-004).

## 3. Camadas dentro de cada módulo

```text
controller (HTTP, validação de forma, DTOs)
   ↓
application service (casos de uso; transações; chama policies; audita)
   ↓
domain (regras e invariantes puras: sem Nest, sem Prisma)   +   policies (autorização)
   ↓
repository (acesso a dados; único sítio que conhece Prisma)
```

Regras:
1. Controllers **não** contêm regras de negócio nem acesso a dados.
2. A autorização é feita **no application service** através do `AccessPolicy` (não só em guards).
3. Regras de domínio (ex.: janela de toma, geração de ocorrências, idade) são funções/classes puras, testáveis sem I/O.
4. Todo acesso a dados de família passa por repositórios que **exigem `familyId`** (isolamento por construção).

## 4. Pedido típico (fluxo de segurança)

```text
Request → rate limit → autenticação (JWT) → carregar User (estado, termos) →
resolver família do caminho → carregar membership do User na família →
AccessPolicy.can(actor, ação, recurso, sujeito) → caso de uso →
transação (+ AuditLog) → resposta
```
Falhas de autorização sobre recursos de outra família devolvem **404** (sem enumeração).

## 5. Alertas: Evento → Regra → Alerta → Notificação

```text
EVENTO       Doses/consultas/exames existem como linhas com instante (scheduledAt).
   ↓         Um scanner (cada minuto, no worker) pergunta à BD "o que venceu?".
REGRA        Funções puras em código, valores por defeito (BR-ALR, R9):
   ↓           dose.due (no horário) · dose.repeat (+15 min se PENDING) ·
   ↓           appointment.24h · appointment.2h · exam.24h · appointment.outcome (+24 h)
   ↓         A regra decide destinatários (FR-ALR-08) e respeita preferências de tipo.
ALERTA       Linha em `alerts` com `dedupeKey` único ⇒ idempotente (NFR-AVL-02).
   ↓
NOTIFICAÇÃO  Uma linha em `notifications` por canal ativo ⇒ job `send-notification`
             (push/e-mail), texto genérico (N8), retry com backoff (ST6).
```

Cada passo é um serviço separado no módulo `alerts`/`notifications`; os canais implementam uma interface `NotificationChannel` (PUSH, EMAIL), preparada para SMS no futuro sem alterar regras (extensão do prompt §18 sem a implementar).

## 6. Tomas: janela móvel

O **plano** guarda a regra; as **ocorrências** são geradas para os próximos 14 dias (job diário + imediatamente ao criar/editar plano, mudar fuso ou tutor principal). Cálculo em UTC a partir da hora local do fuso efetivo (DST: hora inexistente → próxima válida; hora repetida → primeira ocorrência). O scanner e o relatório de adesão trabalham sobre ocorrências reais.

## 7. Autorização

Um único `AccessPolicy` implementa a matriz de `permissions.md`:
`actor (userId, família, papel, memberId) × ação × categoria × sujeito (memberId)` → `ALLOW | DENY`. Relações calculadas: SELF, TUTOR_OF, DEPENDENT_SELF (restrito), OTHER (+ `SharingGrant`). Sem lógica de autorização espalhada. Testes gerados a partir da matriz (Fase 15). Detalhe em `08-security/authorization.md`.

## 8. Ficheiros

Upload multipart → validação (tipo real por *magic bytes*, tamanho) → grava em prefixo de quarentena no armazenamento → linha `documents(scanStatus=PENDING)` → job de antivírus → `CLEAN` (move para prefixo final) ou `INFECTED` (apaga). Download **mediado pela API** (stream), autorizado e auditado; o armazenamento nunca é exposto à internet (ADR-006).

## 9. Apagamento definitivo

Transação apaga linhas e insere `file_deletion` por documento; o worker apaga os objetos e confirma. Backups expiram em ≤30 dias (N6). Auditoria anonimizada.

## 10. Escolhas tecnológicas confirmadas (análise exigida pelo prompt §14)

| Tecnologia proposta | Veredicto | Notas |
|---|---|---|
| NestJS + TypeScript | **Confirmada** | Estrutura modular, DI e testabilidade; equipa de uma pessoa a aprender arquitetura beneficia da convenção. |
| PostgreSQL | **Confirmada** | Relacional, transações, tipos (jsonb, timestamptz), índices parciais necessários (tutor principal, dedupe). |
| Prisma | **Confirmada com cautela** | Bom DX e migrações; não suporta nativamente índices parciais/constraints complexas ⇒ usar SQL manual nas migrações para esses casos (ADR-003). |
| Redis | **Confirmada, âmbito mínimo** | Filas (BullMQ) e rate limit. **Não** é fonte de verdade. |
| MinIO/S3 | **Confirmada** | S3-compatível; em produção usar S3 UE-compatível; mesma API. |
| REST + OpenAPI | **Confirmada** | Contrato primeiro (`openapi.yaml`). |
| Docker | **Confirmada** | Ambientes reproduzíveis. |
| **Acrescentadas:** ClamAV (N4), Web Push (VAPID) + SMTP (D6/D12), pino (logs), Prometheus (métricas) | Necessárias a requisitos aprovados. |

## 11. O que deliberadamente **não** fazemos (anti-overengineering)
Microserviços · event sourcing · CQRS · Kafka · Postgres RLS · encriptação a nível de campo · GraphQL · cache distribuída de leitura · multi-tenancy por base de dados. Cada um pode ser reavaliado por ADR se houver necessidade real.
