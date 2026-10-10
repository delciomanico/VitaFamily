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
| **access** | **Única** fonte de autorização (`AccessPolicy`) e gestão de `SharingGrant`. | families, audit | `AccessPolicy.can()`, `SharingService`, `getEffectiveTimezone` (nota 10) |
| **health-records** | Allergy, MedicalCondition, tipo sanguíneo. | access, audit, families (nota 9) | — |
| **prescriptions** | Prescription e orquestração com planos. | access, medications, documents, audit | — |
| **medications** | MedicationPlan, geração de DoseOccurrence (DST-aware), ações sobre tomas, adesão. | access, audit | `createPlan`/`listPlansForPrescription`/`endPlansForPrescription` (para `prescriptions`, nota 10) |
| **appointments** | Appointment e ciclo de vida. | access, clinics, audit | — |
| **clinics** | Clinic PARTNER/PRIVATE (inclui a gestão de parceiras, exposta pelo `admin` através da API de `clinics`). | access, audit (nota 13) | `ClinicLookup`, `ClinicAdmin` |
| **examinations** | Examination e ExamResult. | access, clinics, documents, audit | — |
| **documents** | Armazenamento, validação, antivírus, download mediado, quotas. | access, audit | `DocumentService` |
| **alerts** | Regras puras, destinatários, scanner e geração idempotente de alertas, listagem/leitura. | medications, appointments, examinations, families, notifications (nota 15) | — |
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
10. `access` expõe `getEffectiveTimezone` (passagem direta para uma nova operação crua de `families`, mesmo critério das notas 7-9): `medications` precisa do fuso efetivo do sujeito (Q8/DM6/BR-MED-08 — o do titular com conta, ou o do tutor principal quando o sujeito não tem conta) para gerar/recalcular qualquer `DoseOccurrence`, mas a tabela não está listada como dependendo de `families` (nem deveria passar a estar: `medications` → `families` → `users`, e qualquer futuro `users`/`families` → `medications` fecharia um ciclo). Como `access` já depende de `families`, expor a função por aqui dá a `medications` (e a `prescriptions`, indiretamente) o dado de que precisa sem nenhuma aresta nova no grafo de módulos. Não é uma decisão de `AccessPolicy.can()` (não há ação/categoria a autorizar: quem chama já autorizou a operação de negócio) — por isso não passa pela política, só pela raiz do módulo. Descoberto durante a implementação de M6; acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control) — mesmo critério das notas 7-9. **Pendente de decisão do proprietário** (ver `medications/README.md`): não existe gatilho imediato quando o `User` muda de fuso ou quando o tutor principal muda (exigiria `users`/`families` → `medications`, o que fecharia o ciclo acima); o job diário `medications.generate-doses` relê o fuso a cada corrida, cobrindo os dois casos com latência até 24h em vez de imediata.
11. `access` expõe `getMembershipFacts` (mesmo critério das notas 7-10): a linha desta tabela já declarava `clinics: ["access"]` (sem `families`), mas `authorization.md` §4 ("Clínicas privadas: criar — adulto da família; editar/arquivar/eliminar — criador ou FAMILY_ADMIN") exige `role`/`isAdult` do actor, que não são decisão de `AccessPolicy.can()` (`clinics` nem está em `HEALTH_MODULES` — não há categoria de dados de saúde envolvida). Como `access` já depende de `families`, `getMembershipFacts(trx, familyId, userId)` (chama `families.findMemberByUserId` e computa `isAdult` com um pequeno cálculo de idade duplicado em `access/domain/age.ts`, pelo mesmo critério de duplicação já usado entre `auth`/`users`/`families`) dá a `clinics` o que precisa sem nenhuma aresta nova no grafo de módulos. Descoberto durante a implementação de M7; acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control) — mesmo critério das notas 7-10. Ver `access/README.md`/`clinics/README.md`.
13. `clinics` → `audit`: a linha original desta tabela só listava `access` — mas toda escrita de `clinics` (`CLINIC_CREATE/UPDATE/STATUS/DELETE`, `ADMIN_CLINIC_CREATE/UPDATE/STATUS`) tem de ser auditada na mesma transação (`conventions.md` §2: "auditoria nas escritas"), mesmo critério já aplicado em `access → audit` (nota 8) e em todos os outros módulos de registos de saúde (`health-records`, `prescriptions`, `medications`, `documents`). Como `audit` não depende de nada (primeira linha desta tabela), acrescentar esta aresta não fecha nenhum ciclo. Descoberto durante a implementação de M7 (o teste de arquitetura falhou com a declaração original); acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control) — mesmo critério das notas 7-12.
14. `clinics` expõe as rotas `/admin/clinics...` (`adminRouter`, UC-ADM-03) diretamente, sem passar por um módulo `admin`: este só existe a partir de M9 (`plan.md` §4, "FR-ADM-01 (contas)"), mas FR-ADM-01 (clínicas) é M7. A tabela desta secção já previa isto ("clinics… inclui a gestão de parceiras, exposta pelo admin através da API de `clinics`"); nesta implementação, até `admin` existir, `main/api.ts` monta `clinics.router` e `clinics.adminRouter` lado a lado (nenhuma aresta nova — `admin` continua a não ser importado por `clinics`). Quando M9 criar `admin`, a expectativa é que monte/delegue `clinics.adminRouter` em vez de duplicar as rotas. Descoberto durante a implementação de M7; acrescentado aqui pelo mesmo critério das notas 7-11.
15. `alerts` → `notifications` (M8): a linha original desta tabela só listava `medications,
    appointments, examinations, families` para `alerts` e `users` para `notifications` — nenhuma
    aresta entre os dois. Mas o pipeline obrigatório Evento→Regra→Alerta→Notificação
    (`architecture.md` §5) exige que, ao criar um `Alert`, alguém crie também as linhas
    `notifications` por canal ativo (entities.md: `notifications.alert_id FK→alerts`) e que, ao
    marcar um alerta como lido antes do envio, alguém cancele (`SKIPPED`) as notificações ainda
    pendentes (state-machines.md "Notification"). Como `notifications` só depende de `users` (não
    pode ler `alerts` sem fechar um ciclo com a aresta inversa) e `conventions.md` §3.5 proíbe
    `alerts` de escrever na tabela `notifications` diretamente, a orquestração fica em `alerts`
    (que já orquestra o resto do pipeline), chamando `notifications.enqueueForAlert`/
    `isTypeEnabled`/`skipPendingForAlert` pela raiz — mesmo critério de `medications` ↔
    `prescriptions` (nota 6: a orquestração fica no módulo de nível mais alto do pipeline, nunca o
    inverso). Para que `notifications` nunca precise de ler `alerts` (SKIPPED por "conta
    suspensa"/"canal desativado" no envio), a tabela `notifications` ganhou uma coluna
    `recipient_user_id` desnormalizada (escrita uma única vez em `enqueueForAlert`), fora do
    desenho original de `schema.md` §4 — documentado também aí e em `notifications/README.md`.
    Na mesma implementação: `notification_preferences` já existia desde M1
    (`0002_identity.sql`, criada em antecipação a este módulo), mas `users/infrastructure/`
    chegou a declarar o seu tipo Kysely e a inserir uma linha por omissão no registo — duas
    violações de `conventions.md` §3.5 (só o repositório do módulo dono acede à tabela) agora
    corrigidas: a declaração/escrita saiu de `users`, que passa a não tocar nesta tabela; ver
    NOTA em `users/infrastructure/schema.ts`.
    Descoberto durante a implementação de M8; acrescentado aqui em vez de alterado silenciosamente
    (CLAUDE.md, change control) — mesmo critério das notas 7-14.
16. `families` expõe `listGuardianUserIds` (M8, mesmo critério das notas 7-11/anteriores): `alerts`
    precisa dos tutores com conta de um dependente (FR-ALR-08/BR-PRV-06) para calcular
    destinatários, mas `conventions.md` §3.5 proíbe-o de aceder a `guardianships`/`family_members`
    diretamente. `listGuardianUserIds(trx, familyId, dependentId)` (nova operação crua de
    `families`, mesmo critério de `findMemberById`/`isGuardianOf` já expostos a `access`) devolve
    só os `userId` dos tutores (nunca o `FamilyMember` completo). Descoberto durante a
    implementação de M8; acrescentado aqui pelo mesmo critério das notas 7-15.

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
