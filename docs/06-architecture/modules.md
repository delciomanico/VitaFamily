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
| **appointments** | Appointment e ciclo de vida; pedidos/agenda de consultas do portal da clínica (`/clinic-portal/requests`, `/agenda`). | access, clinics, audit | — |
| **clinics** | Clinic PARTNER/PRIVATE (inclui a gestão de parceiras, exposta pelo `admin` através da API de `clinics`); `ClinicAccount`/`clinic_sessions` e `ClinicSlot` (com `kind` e `capacity`), com as rotas `/clinic-portal/auth`, `/staff`, `/slots` (inclui `PATCH` de capacidade). **M14 a1/a2 (ADR-026):** também `ClinicProfessional`, `ClinicServiceType`, `ClinicScheduleRule`, `ClinicTimeOff` e a geração de horários (rotas `/professionals`, `/services`, `/schedule-rules`, `/time-off`; job `clinics.generate-schedule`); a ocupação continua a vir da porta `slotOccupancy` injetada no composition root (sem aresta nova `clinics` → `appointments`/`examinations`). | access, audit (nota 13) | `ClinicLookup`, `ClinicAdmin` |
| **examinations** | Examination e ExamResult; marcação direta (`SCHEDULED`) de exames em horários de clínica parceira com vagas (reserva sob bloqueio do horário, BR-APT-11), cancelamento e conclusão pela clínica (router `/clinic-portal/exam-agenda*`, ADR-023 revisto 2026-11-04; sem pedidos nem job de expiração). | access, clinics, documents, audit | `ExaminationLookup` (para `recommendations`/`alerts`) |
| **clinic-portal** (transversal, **não é módulo próprio**) | O prefixo `/clinic-portal/*` (ADR-020/023; segundo ator `ClinicActorInfo`, nunca `AccessPolicy`) é servido por routers de módulos existentes: `clinics` (`auth`, `staff`, `slots`, `professionals`, `services`, `schedule-rules`, `time-off`), `appointments` (`requests`, `agenda`), `examinations` (`exam-agenda`, `exam-agenda/*/documents`), `recommendations` (`recommendations`). | os do módulo que serve cada rota | — |
| **clinic-patients** (M14 P, ADR-026; **declarativo até ao arranque da implementação**, nome provisório; pode dividir-se por ADR-016) | `ClinicPatient`, `ClinicPatientLink`, `ClinicConsent`, `ClinicLinkCode`, `ClinicVisit` (`schema.md` §3d); rotas `/clinic-portal/patients*`, `/clinic-portal/search`, `/clinic-portal/calendar` (portal, `ClinicActorInfo`) e `/families/{f}/members/{m}/clinic-consents*`, `clinic-link-codes` (família, `AccessPolicy`/`getMembershipFacts`: só `SELF`/`TUTOR_OF`); job `clinic-patients.purge-link-codes`. **Portas** (definidas na sua `application`, ligadas no composition root): `MemberDirectory` (resolver o membro `SELF` por e-mail exato e o nome de apresentação — reutiliza a lógica de BR-CLN-10 —, e validar titular/tutor; implementada por `access`/`families`), `SharedHistoryReader` (medicação ativa e exames; implementada por `medications` e `examinations`, só leitura), `CalendarSource` (consultas e exames da clínica; implementada por `appointments`/`examinations`; horários por `clinics`) e `SlotReservation` (bloqueio do horário e ocupação, partilhada com `appointments`). `appointments` (walk-in) chama a porta `ClinicPatientDirectory` (criar/ligar paciente, consentimento `BOOKINGS`) implementada por este módulo. Nenhum módulo de saúde importa `clinic-patients` (só a porta). | access, clinics, audit (via portas acima) | `ClinicPatientDirectory` |
| **recommendations** | Recommendation (nota clínica da clínica sobre consulta/exame, ADR-023); leitura pela família. | access, appointments, examinations, audit | `RecommendationQuery` (para `alerts`) |
| **insurance** / **insurance-portal** | `InsurancePolicy`, `ReimbursementClaim` e portal da seguradora (ADR-021, ADR-023); ADR-025: `insurer_accounts` ganha `currency`/`operational_module_enabled`, `reimbursement_claims.encounter_id`. `insurance`: access, documents, audit; `insurance-portal` só lê `insurance` pela raiz; nunca `auth`/`access`/`families`/`clinics`. | ver ADR-021 | — |
| **insurer-ops** (ADR-025, nome provisório; pode dividir-se por ADR-016) | Módulo operacional de seguradoras: `Company`, `Beneficiary` (+ligação consentida), `Plan`/`PlanCoverage`/`InsurerService`, `Policy`, `Provider`, `AuthorizationRequest`, `Encounter`, `ExpenseClaim`, `CoverageConsumption`, importação, dashboard. Serve três prefixos: `/insurance-portal/*` (papéis de §8.2b), `/clinic-portal/insurers/*` (§8.4, ator `ClinicAccount`) e `/families/{f}/members/{m}/insurance/*` (§8.5, `AccessPolicy`, categoria de seguro). Só ativo para seguradoras com `operational_module_enabled`. Dados **da seguradora**, nunca de saúde. | access (só rotas do paciente), clinics (só `ClinicLookup`), documents (só armazenamento/antivírus de anexos, via raiz), insurance (lê `insurer_accounts` e `reimbursement_claims` pela raiz), audit (nota 23) | `EligibilityQuery`, `BeneficiaryLookup` (para `insurance`, BR-SEG-21) |
| **documents** | Armazenamento, validação, antivírus, download mediado, quotas. | access, audit | `DocumentService` |
| **alerts** | Regras puras, destinatários, scanner e geração idempotente de alertas, listagem/leitura. | medications, appointments, examinations, families, notifications (nota 15) | — |
| **notifications** | Canais e entrega (push/e-mail), preferências, subscrições, retry. | users | `NotificationChannel`, `Mailer` |
| **reports** | Vistas calculadas respeitando `AccessPolicy`. | access + módulos de leitura | — |
| **lifecycle** | Exportações, saída/remoção de membros, maioridade, bloqueio e apagamento a 90 dias, limpeza de ficheiros. | families, documents, notifications, audit | — |
| **admin** | Contas (listar/pesquisar, detalhe, suspender, reativar, repor acesso — ADR-023) e rotas `/admin`; delega as clínicas parceiras (e as suas contas de portal) em `clinics` e as seguradoras em `insurance`. Sem acesso a dados de saúde. | users, clinics, insurance, auth (só porta de reposição de acesso, nota 22), audit | — |

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

23. (ADR-025, D21 — **declarativa até S1**) `insurer-ops` é módulo novo, **não importa** `auth`, `families`, `clinic-portal`, `reports`, módulos de saúde. Arestas: (a) `insurer-ops` → `access` só nas rotas do paciente (§8.5), ator `User`; as rotas `/insurance-portal/*` e `/clinic-portal/insurers/*` usam os seus próprios contextos (`InsuranceActorInfo`/`ClinicActorInfo`) e nunca `AccessPolicy`; (b) `insurer-ops` → `clinics` por `ClinicLookup` (validar que a clínica é `PARTNER` ao ligar um `Provider`); (c) `insurer-ops` → `documents` só pela raiz, para armazenamento/antivírus de anexos (pendência de ADR-025); (d) `insurer-ops` → `insurance` (lê `insurer_accounts`, `currency`, `operational_module_enabled`) e `insurance` → `insurer-ops` por **interface de consulta** (`BeneficiaryLookup`/`EncounterDirectBilled`, BR-SEG-21) — **risco de ciclo**: a porta é definida em `insurance/application` e implementada por `insurer-ops/interface`, ligada em `main/api.ts` (mesmo critério da nota 20), `insurance` nunca importa `insurer-ops`; (e) `admin` → `insurance` para ativar o módulo/moeda (BR-ADM); (f) a ligação paciente↔beneficiário usa `family_members` **só** pela FK composta e por uma porta `FamilyMemberLookup` (família resolve "o `userId` é `SELF`/`TUTOR_OF` deste membro"); `insurer-ops` nunca lê tabelas de `families`. Testes de arquitetura validam todas.
24. (ADR-026, M14 P — **declarativa até à implementação**) `clinic-patients` é a fronteira do registo de pacientes da clínica e do consentimento. **Não** importa os módulos de saúde (`medications`, `examinations`, `appointments`) nem `families`/`auth`: tudo o que precisa de dados Vita vem por **portas** da sua `application` (ADR-016). O `ClinicConsent` (e não a `AccessPolicy`) é o critério de leitura do histórico partilhado, avaliado a cada pedido; as rotas do lado família usam `getMembershipFacts` (nota 11) para exigir `SELF` adulto ou `TUTOR_OF`. O portal nunca recebe ids Vita: a resolução `clinicPatientId → memberId` fica na porta `MemberDirectory`/`SharedHistoryReader`, no servidor. O apagamento do membro/conta/família remove ligações, consentimentos e códigos por `ON DELETE CASCADE` (BR-CLN-24); `lifecycle` (exportação do membro) passa a incluir o estado dos consentimentos (não o registo da clínica, que é dela).

## 4. Processos (API vs worker)

| Processo | Módulos ativos | Tarefas |
|---|---|---|
| **API** | todos os controllers | HTTP |
| **Worker** | `clinics` (gerar horários, M14), `insurer-ops` (expirar autorizações/apólices), `alerts`, `notifications`, `medications` (geração/UNCONFIRMED), `documents` (antivírus), `lifecycle`, `audit` (purga), `auth` (limpeza de tokens/sessões), `families` (expirar convites) | filas e agendamentos |

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
| `insurer.expire-authorizations` | diário (ADR-025, S4) | `APPROVED\|AUTO_APPROVED` com `validUntil` passado → `EXPIRED` e libertar reserva (idempotente, auditada como `SYSTEM`). |
| `insurer.expire-policies` | diário (ADR-025, S1) | `ACTIVE` com `validTo` passado → `EXPIRED`. |
| `clinic-patients.purge-link-codes` | diário (M14 P, BR-CLN-20) | Apaga `clinic_link_codes` expirados ou usados há mais de 24 h (idempotente; sem auditoria por linha, uma entrada `SYSTEM` com contagem). |
| `clinics.generate-schedule` | diário (M14 a2, BR-CLN-12) | Para cada regra ativa de profissional/serviço ativos, gerar `ClinicSlot` da janela de 8 semanas (idempotente: `ON CONFLICT DO NOTHING`; ignora passado, bloqueios e sobreposições); auditoria `CLINIC_SCHEDULE_GENERATE` como `SYSTEM`, só contagens. |

> `examinations.expire-requests` (BR-EXM-07) **não faz parte do contrato**: obsoleto desde a revisão de 2026-11-04 do ADR-023 (exames nascem `SCHEDULED`, não há pedidos). BR-APT-08 (expiração de pedidos de **consulta**) continua `PROPOSTO` e **sem job** no contrato nem no código; só passa à tabela se o proprietário o aprovar.

### Notas M9 (reports, admin, lifecycle)
16. `reports` e `lifecycle` (exportação) leem os módulos de saúde por **portas definidas na sua `application`** (`ReportSources`, `ExportSources`), ligadas no composition root a leituras públicas (`reads`, contrato em `platform/reads`) de cada módulo dono — mesma `AccessPolicy` e auditoria dos endpoints GET; nenhuma aresta nova no grafo, mas `main/api.ts` passa a ligar `families`, `health-records`, `prescriptions`, `medications`, `appointments`, `examinations` e `documents` a estes dois módulos (`lifecycle` lista só `families, documents, notifications, audit` na tabela; as leituras de saúde entram apenas pelas portas). Descoberto durante M9; acrescentado aqui em vez de alterado silenciosamente (CLAUDE.md, change control).
17. A exportação de dados é gerada no processo da API, não no job `lifecycle.build-export` do worker (§5), porque o worker não monta os módulos de saúde. Pendente de decisão do proprietário: mover para o worker (exige montar `access` + módulos de saúde aí).
18. `users` expõe `listAccounts`/`setSuspension` (operações cruas) para `admin` (FR-ADM-01).
19. A rota `POST /families/{f}/members/{m}/exports` passou de `families` (stub) para `lifecycle`; `families` mantém só as suas leituras.
20. `families` recebe por injeção a porta `memberData` (ficheiros e pacote de dados ao sair/remover membros, eliminar família), ligada em `main/api.ts` a `documents` e `lifecycle` — resolve-se tardiamente porque `documents`/`lifecycle` dependem de `families`; `families` não importa nenhum dos dois. `families` expõe ainda `actions` (sair/eliminar família em nome do utilizador, com as mesmas regras) e `lifecycleOps` (maioridade/bloqueio) para `lifecycle`; `documents` expõe `purgeMemberFiles`/`purgeFamilyFiles` e o job `documents.delete-files` (a outbox `file_deletions` é tabela de `documents`, por isso o job vive aí e não em `lifecycle` como previa a tabela §5).
21. `DELETE /users/me` passou de `users` (stub) para `lifecycle` (precisa de famílias, ficheiros e auditoria); `users` expõe `deleteAccount` (operação crua) e `auth` expõe `verifyPassword`.
22. (ADR-023, D19) Fronteiras novas: (a) `examinations` ganha router do portal da clínica (mesmo padrão de `appointments/interface/clinic-portal-router.ts`) e depende de `clinics` só por `ClinicLookup`; o upload de PDF da clínica entra por uma função da raiz de `documents` (autorização do portal, não `AccessPolicy`); (b) `recommendations` é módulo novo (`appointments`/`examinations` expõem uma consulta "esta origem pertence à clínica X e está em estado Y"); `alerts` → `recommendations` por interface de consulta, sem ciclo; (c) `admin` passa a expor `GET/POST /admin/users/*` (detalhe, reset-access) e `/admin/clinics/{id}/accounts*`, delegando em `users`, `auth` (só emitir o token de recuperação, através de uma porta) e `clinics` — continua sem importar módulos de saúde; (d) `GET /families/{f}/insurers` vive em `insurance` (lê `insurer_accounts` via a sua raiz). Todas as arestas novas são declarativas até à implementação; o teste de arquitetura valida-as.
