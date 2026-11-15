# Módulo `processes`

Marco B fatia 1 (ADR-032, BR-PRC-01..11, UC-PRC-01..06, AC-PRC-01..07). `Process` = **agregador de leitura**: um id (`processId`) por ato com ids Vita (consulta ou exame) e um estado simples para a família — `SCHEDULED | IN_PROGRESS | DONE | CANCELLED` + `nextStep { code, actor }` ("o que falta e de quem") — **derivado em leitura**, nunca persistido. Sem seguradora, autorização, despesa, urgência nem notificações (fatias 2–6). Depende só de `access` e `audit` (modules.md §3 nota 29).

## Regras que o código impõe
- **Estado derivado por função pura:** `domain/derive-family-status.ts` (`deriveFamilyStatus({ act: { phase } })`): tabela de verdade de 6 linhas (`Record<ActPhase, …>` obriga o compilador a verificar a totalidade). Sem relógio, I/O, nem imports fora de `domain/` (verificado em `tests/architecture-rules.ts`). Nova fase/fonte = linha nova na tabela, sem tocar no resto.
- **Fronteiras sem imports em nenhum sentido (BR-PRC-04):** `processes` não importa `appointments`/`examinations` e estes não o importam. Duas portas, ligadas em `main/api.ts`:
  - `ProcessFacts` (definida em `application/ports.ts`, **implementada pelos donos** via `getActFacts`): lote de `ActFact { source, phase, scheduledAt?, changedAt }` por consulta/exame; a projeção estado do ato → `phase` é função pura do dono (`appointments/domain/act-phase.ts`, `examinations/domain/act-phase.ts`). Modelo *pull*: sem cópia do estado, logo sem deriva a reconciliar.
  - `ProcessLinker` (definida **em cada dono**, `application/ports.ts`; **implementada aqui**, `application/link-process.ts`): `open` (idempotente por `(originType, originId)`) e `discard`, na transação do ato. Os 5 pontos de abertura: `createAppointment` (livre e com `slotId`), marcação presencial D20 e `createExamination` (livre e com `slotId`); apagar: `deleteAppointment`/`deleteExamination`. Visitas manuais e recibos (sem ids Vita, BR-CLN-24) não abrem processo.
- **Leitura da família (BR-PRC-05):** `application/readable-categories.ts` chama `AccessPolicy.can(READ, APPOINTMENTS|EXAMS)` uma vez por categoria; a lista **filtra**, o detalhe de categoria não legível/outro membro/inexistente é `404` (sem enumeração); Platform Admin ⇒ `404`; `MEMBER_BLOCKED` propaga. Auditoria `PROCESS_VIEW` só para tutor e `OTHER` (não para o titular).
- **Paginação com filtro depois da derivação (`list-processes.ts`):** ordem `openedAt` desc, `id` desc; varre a BD em lotes até `limit` itens ou 200 processos; se esgota o varrimento com menos itens e ainda há dados, `nextCursor` continua não nulo. Cursor inválido ⇒ `MALFORMED_REQUEST`. A BD ordena por `date_trunc('milliseconds', opened_at)` (cursor em ms; o backfill pode trazer µs).
- **Processo sem ato legível (BR-PRC-09):** omitido na lista, `404` no detalhe, nunca 5xx; `onInconsistency` (ligado ao logger em `main/api.ts`) regista só `processId` e `originType`.
- **Clínica (BR-PRC-06):** `GET /clinic-portal/processes/{id}` só Admin/Gestor (Médico ⇒ `403`), só `clinic_id` = clínica do token; resposta mínima (id, tipo, origem, fase, abertura), sem ids Vita, `familyStatus` nem `nextStep`; não usa `AccessPolicy` (ADR-020) nem audita. A matriz papel×rota vive em `clinics/domain/clinic-portal-access.ts`.
- **Auditoria (BR-PRC-11):** `PROCESS_OPEN`/`PROCESS_DISCARD` na transação do ato (o ator é o do fluxo que cria/apaga, passado em `by`), `metadata` só `originType`/`kind`/`count`.

## Mapa de um pedido típico
```
POST /families/{f}/members/{m}/appointments        (appointments/application/create-appointment.ts, UMA transação)
  → processes.linker.open (porta ProcessLinker, ligada em main/api.ts) → link-process.ts → infrastructure/repo.ts insertIfAbsent + PROCESS_OPEN
  → appointmentsRepo.insert({ …, processId })

GET /families/{f}/members/{m}/processes
  → interface/router.ts → application/list-processes.ts
    → readable-categories.ts (AccessPolicy.can por categoria) → repo.listOfMember (lote)
    → facts.getActFacts (porta ProcessFacts → appointments/examinations.getActFacts → projectActPhase)
    → domain/derive-family-status.ts → filtro status → PROCESS_VIEW (tutor/OTHER) → { items, nextCursor }
```

## Camadas presentes
`domain/` (tipos, `deriveFamilyStatus`) · `application/` (casos de uso, portas, `fixtures.ts` com fakes) · `infrastructure/` (`schema.ts`, `repo.ts` Kysely) · `interface/` (router da família, router do portal da clínica, `dto.ts`).

## Migração
`db/migrations/0036_processes.sql`: enums `process_kind`/`process_origin_type`, tabela `processes` (sem `family_status`), `process_id` NULLABLE em `appointments`/`examinations` (UNIQUE parcial) e backfill idempotente. O `NOT NULL` fica para uma migração posterior, depois do backfill verificado em dados reais.

## Testes
`domain/derive-family-status.test.ts` (TC-PRC-01..07) · `application/processes.test.ts` e `read-matrix.matrix.test.ts` (TC-AZ-PRC-01, matriz de §6.8 sobre a `AccessPolicy` real) · `appointments|examinations/domain/act-phase.test.ts` e `application/process-link.test.ts` (TC-PRC-08..13) · `tests/http/processes.http.test.ts` (contrato OpenAPI, tokens, isolamento) · `tests/integration/processes.integration.test.ts` (PostgreSQL real: backfill, constraints, cascatas, rollback, leitura sobre adaptadores reais) · `tests/architecture.test.ts` (TC-PRC-20).

## Fatia 3 (ADR-034): processos abertos por autorização
`originType=AUTHORIZATION` (`kind=AUTHORIZED`, derivado da origem em `domain/process.ts#kindOfOrigin`) não tem ato: o estado vem só do facto de cobertura (`ProcessFacts.getCoverageFacts`, implementado por `insurer-ops`; `application/load-facts.ts` carrega os dois factos em lote). `deriveFamilyStatus({ act?, coverage? })` continua pura e ganhou a tabela 3 de `state-machines.md`. A leitura da família de processos `AUTHORIZATION` usa `AccessPolicy.can(MANAGE_INSURANCE)` (`readable-categories.ts`); a da clínica devolve `phase` nula. `linker.findForClinic` (só leitura) valida o `processId` de um pedido. `processes` e `insurer-ops` não se importam (`tests/architecture.test.ts`, TC-AUT-19).

## Fatia 5 (ADR-036): vista da família
`domain/derive-coverage-view.ts` — `deriveCoverageView` (pura, TC-PRC-29): `Process.coverage = {state, appeal, partial, dueAt?, validUntil?}`; nunca motivo, valor, serviço, decisor nem rasto (BR-PRC-12). `readable-categories.ts` devolve `coverageVisible` (a mesma decisão `MANAGE_INSURANCE`, uma vez por pedido): sem ela a cobertura não entra na derivação (`DEPENDENT_SELF`/`OTHER` veem só a linha do ato, sem erro; BR-PRC-13); ato `DONE`/`CANCELLED` ⇒ `coverage = null`. `deriveFamilyStatus` ganhou as linhas «sem ato» `EXPIRED`/`WITHDRAWN` (`COVERAGE_EXPIRED`/`COVERAGE_WITHDRAWN`, `actor=FAMILY`). `application/describe-for-alerts.ts` (raiz: `describeForAlerts`) é a leitura de sistema usada por `alerts` (dono do processo e «aberto»).
