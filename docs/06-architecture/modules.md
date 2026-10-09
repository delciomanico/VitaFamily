# Vita Family — Módulos (Fase 11)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture: `domain/application/infrastructure/interface`), Kysely+`pg`+runner próprio de migrações, pg-boss, **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ, Jest ou Go, ler o equivalente de ADR-014/ADR-015; a arquitetura lógica (responsabilidades e dependências por módulo) mantém-se.

> Estado: **v0.1**. Um módulo = uma responsabilidade coerente (não uma tabela). Dependências só "para baixo"; nenhum ciclo.

## 1. Estrutura de pastas (ADR-013; relativa a `apps/api/internal`)

```text
platform/                 # kit técnico partilhado (config, clock, db, httpx, logx, storage, mail, push, ids, jobs)
api/                      # router + composição dos handlers + gen/ (contrato gerado)
modules/
  audit users auth families access healthrecords prescriptions medications appointments
  clinics examinations documents alerts notifications reports lifecycle admin
  └─ cada um: <m>.go (raiz/API pública) + internal/{domain,service,repo,handler}
```
Dois pontos de entrada no mesmo binário: `vita api` e `vita worker` (ver `cmd/vita`).

## 2. Responsabilidades e dependências

| Módulo | Responsabilidade | Depende de (API pública) | Expõe |
|---|---|---|---|
| **common** | Infraestrutura técnica partilhada. Sem regras de negócio. | — | Clock, Id, ProblemException, Pagination, Config |
| **audit** | Escrever e anonimizar logs de auditoria; purga a 24 meses. | common | `AuditService.record()` |
| **users** | Conta, perfil, fuso, preferências de termos, eliminação. | common, audit | `UsersService` |
| **auth** | Registo, login, sessões, tokens, recuperação, verificação, rate limiting de autenticação. | users, notifications (e-mail), audit, **families** (só para consumir convite de conta de dependente no registo — UC-MEM-05/BR-MEM-12/13/17) | `AuthGuard`, `CurrentUser` |
| **families** | Family, FamilyMember, Guardianship, Invitation e as suas invariantes. | users, audit, notifications | `MembershipService`, `GuardianshipService` |
| **access** | **Única** fonte de autorização (`AccessPolicy`) e gestão de `SharingGrant`. | families, audit | `AccessPolicy.can()`, `SharingService` |
| **health-records** | Allergy, MedicalCondition, tipo sanguíneo. | access, audit, families (nota 9) | — |
| **prescriptions** | Prescription e orquestração com planos. | access, medications, documents, audit | — |
| **medications** | MedicationPlan, geração de DoseOccurrence, ações sobre tomas, adesão. | access, audit | `DoseGenerator`, `AdherenceQuery` |
| **appointments** | Appointment e ciclo de vida. | access, clinics, audit | — |
| **clinics** | Clinic PARTNER/PRIVATE (inclui a gestão de parceiras, exposta pelo `admin` através da API de `clinics`). | access | `ClinicLookup`, `ClinicAdmin` |
| **examinations** | Examination e ExamResult. | access, clinics, documents, audit | — |
| **documents** | Armazenamento, validação, antivírus, download mediado, quotas. | access, audit | `DocumentService` |
| **alerts** | Regras puras, destinatários, scanner e geração idempotente de alertas, listagem/leitura. | medications, appointments, examinations, families | — |
| **notifications** | Canais e entrega (push/e-mail), preferências, subscrições, retry. | users | `NotificationChannel`, `Mailer` |
| **reports** | Vistas calculadas respeitando `AccessPolicy`. | access + módulos de leitura | — |
| **lifecycle** | Exportações, saída/remoção de membros, maioridade, bloqueio e apagamento a 90 dias, limpeza de ficheiros. | families, documents, notifications, audit | — |
| **admin** | Contas (listar, suspender, reativar) e rotas `/admin`; delega as clínicas parceiras em `clinics`. Sem acesso a dados de saúde. | users, clinics, audit | — |

## 3. Regras de dependência (verificadas por teste de arquitetura)

1. `common` não importa de nenhum módulo.
2. Módulos de **registos de saúde** (`health-records`, `prescriptions`, `medications`, `appointments`, `examinations`, `documents`) só importam `access`, `audit`, `common` e módulos de que dependem explicitamente na tabela.
3. `alerts` lê registos através de **interfaces de consulta** (ex.: `DueDosesQuery`) fornecidas pelos módulos donos; não acede às suas tabelas.
4. `admin` **não importa** nenhum módulo de registos de saúde (garante D4 por construção, NFR-SEC-10).
5. Só os repositórios de cada módulo acedem às suas tabelas.
6. Ciclos proibidos (ex.: `medications` ↔ `prescriptions`: a orquestração fica em `prescriptions`, que chama `medications`).
7. `auth` → `families` é intencional e **unidirecional** (`families` nunca importa `auth`): o registo de conta de dependente (UC-MEM-05) só valida/consome o convite através da API pública de `families`, na mesma transação da criação do `User`. Descoberto durante a implementação de M2; documentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control).
8. `access` → `audit`: a linha original desta tabela só listava `families`, mas `audit.md` §3 já previa a ação `SHARING_UPDATE` (partilha) — sem `audit` como dependência declarada, `access` não teria forma de a registar na mesma transação (conventions.md §2, mesmo critério de `users`/`families`/todos os módulos que escrevem dados sensíveis). Descoberto durante a implementação de M3; acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control) — mesmo critério da nota 7.
9. `health-records` → `families`: a linha original só listava `access, audit`, mas `schema.md` §2 guarda `blood_type` na própria tabela `family_members` (entities.md: campo de `FamilyMember`, não uma tabela própria de `health-records`) — e `conventions.md` §3.5 proíbe `health-records` de aceder a essa tabela diretamente (só o repositório de `families` o pode fazer). `getBloodType`/`putBloodType` (`endpoints.md`) decidem a autorização pela matriz de `ALLERGIES` (`access.policy.can()`, inalterado), mas a leitura/escrita do valor em si só pode passar pela API pública de `families` (duas novas operações cruas, `getBloodType`/`setBloodType`, mesmo critério de `findMemberById`/`isGuardianOf` já expostos para `access`). Sem isto, `health-records` não teria forma de implementar FR-HP-01 (tipo sanguíneo) sem duplicar a tabela ou violar a fronteira de repositórios. Descoberto durante a implementação de M4; acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control) — mesmo critério das notas 7/8. Não há ciclo: `families` continua a não depender de `health-records`.

## 4. Processos (API vs worker)

| Processo | Módulos ativos | Tarefas |
|---|---|---|
| **API** | todos os controllers | HTTP |
| **Worker** | `alerts`, `notifications`, `medications` (geração/UNCONFIRMED), `documents` (antivírus), `lifecycle`, `audit` (purga), `auth` (limpeza de tokens/sessões), `families` (expirar convites) | filas e agendamentos |

## 5. Jobs agendados

| Job | Frequência | Função |
|---|---|---|
| `alerts.scan` | 1 min | Gerar alertas vencidos (idempotente). |
| `notifications.send` | fila | Enviar push/e-mail; retry. |
| `medications.generate-doses` | diário + sob demanda | Janela de 14 dias. |
| `medications.mark-unconfirmed` | 5 min | PENDING → UNCONFIRMED após 2 h. |
| `documents.scan` | fila | Antivírus. |
| `lifecycle.coming-of-age` | diário | Avisos 30/7/0 dias; transição aos 18 (P4, B1). |
| `lifecycle.blocked-members` | diário | Avisos 0/30/60/83; apagar aos 90 (B2). |
| `lifecycle.build-export` | fila | Gerar pacote JSON+documentos. |
| `lifecycle.delete-files` | 5 min | Processar `file_deletion`. |
| `families.expire-invitations` | horário | PENDING → EXPIRED. |
| `auth.cleanup` | diário | Tokens/sessões expirados. |
| `audit.purge` | diário | Remover logs com >24 meses. |
