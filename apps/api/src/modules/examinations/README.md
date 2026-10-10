# Módulo `examinations`

M7 (`plan.md` §4): `Examination` e `ExamResult` (FR-EXM). Depende de `access` (categoria `EXAMS`), `clinics` (`ClinicLookup`), `documents` (documentos do exame, FR-DOC-04) e `audit` (modules.md §2).

## O sistema nunca interpreta resultados (D11/FR-EXM-05)

`ExamResult` guarda exatamente o que o utilizador introduziu (`valueNumeric`/`valueText`, `unit`, `referenceMin`/`referenceMax` — todos informados por ele, nunca calculados). Não há campo "fora do intervalo", não há alerta gerado por este módulo por causa de um valor (testado em `application/examinations.test.ts`, "AC-EXM-01/D11").

## ST5: estado inicial e resultados só em `COMPLETED`

`deriveInitialExaminationStatus` (`domain/examination.ts`) decide o estado à criação por comparação de datas (`examDate <= hoje` nasce `COMPLETED`, senão `SCHEDULED`) — mesmo critério de `BR-RX-01`/`assertValidIssuedOn`, mas sem a restrição "não futura" (um exame pode ser agendado). `addExamResult` recusa com `INVALID_STATE_TRANSITION` se o exame não estiver `COMPLETED` (endpoints.md `addExamResult`, ST5).

## Âmbito concluído em M8 (`alerts`)

`BR-EXM-03`/`TC-ALR-07` (lembrete 24h antes de um exame futuro) é responsabilidade do scanner de `alerts` (M8), implementado — mesmo critério documentado em `appointments/README.md`. Este módulo expõe só `createExaminationsReminderQueries#listReminderCandidates` (raiz mínima, sem `access`/`clinics`/`documents`); o instante exato do lembrete (fuso efetivo do sujeito) é calculado em `alerts/domain/timezone.ts`, não aqui.

## Mapa de um pedido típico
```
POST /families/{familyId}/members/{memberId}/examinations/{id}/results
  → interface/router.ts
    → application/add-exam-result.ts
      → access/index.js (policy.can)              # CREATE/EXAMS
        → examinationsRepo.findById                # confirma status === COMPLETED (ST5)
          → examResultsRepo.insert
            → audit.record(trx, …)                 # EXAM_RESULT_CREATE
```
```
DELETE /families/{familyId}/members/{memberId}/examinations/{id}
  → application/delete-examination.ts              # FR-DOC-04
    → documents/index.js (deleteAllForResource)     # outbox de ficheiros ANTES de apagar a linha
      → infrastructure/repo.ts (delete)             # CASCADE apaga exam_results
```

## Camadas presentes
- `domain/examination.ts` — `assertValidExaminationTransition` (state-machines.md "Examination": `SCHEDULED↔{COMPLETED,CANCELLED}`, `CANCELLED→SCHEDULED`; `COMPLETED` é final), `deriveInitialExaminationStatus` (ST5), `assertValidExaminationName`, `assertValidExamDate`.
- `domain/exam-result.ts` — `assertHasValue` (BR-EXM-01: pelo menos numérico ou texto), `assertValidReferenceRange` (schema.md CHECK), `assertValidParameter`.
- `application/` — `examination-view.ts` (junta `results`+`documentIds`, mesmo critério de `prescriptions/application/prescription-view.ts`); `support.ts` (`auditViewIfNotSelf`; `resolveClinicSnapshot`, duplicado de `appointments/application/support.ts` — mesma forma, módulos só se importam pela raiz); um ficheiro por caso de uso de exame e de resultado; `exam-result-history.ts` (UC-EXM-04, join com `examinations` na `infrastructure`).
- `infrastructure/` — `KyselyExaminationsRepository` + `KyselyExamResultsRepository` (duas tabelas, um módulo).
- `interface/` — as 9 rotas de "Examinations" em `endpoints.md`.

## Migração
`db/migrations/0008_clinics_appointments_examinations.sql`: `examinations`/`exam_results` + `ALTER TABLE documents ADD CONSTRAINT documents_examination_fk ...` (Fase 2 do esquema de `documents`, prevista em `migrations.md`/`0006_documents.sql`).
