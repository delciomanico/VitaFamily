# Vita Family — Módulos (Fase 11)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

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
| **auth** | Registo, login, sessões, tokens, recuperação, verificação, rate limiting de autenticação. | users, notifications (e-mail), audit | `AuthGuard`, `CurrentUser` |
| **families** | Family, FamilyMember, Guardianship, Invitation e as suas invariantes. | users, audit, notifications | `MembershipService`, `GuardianshipService` |
| **access** | **Única** fonte de autorização (`AccessPolicy`) e gestão de `SharingGrant`. | families | `AccessPolicy.can()`, `SharingService` |
| **health-records** | Allergy, MedicalCondition, tipo sanguíneo. | access, audit | — |
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
