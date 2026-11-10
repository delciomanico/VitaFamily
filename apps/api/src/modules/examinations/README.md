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
- `domain/examination.ts` — `assertValidExaminationTransition` (state-machines.md "Examination": `SCHEDULED→{COMPLETED,CANCELLED}`, `CANCELLED→SCHEDULED` só sem `slotId`; `COMPLETED` é final), `deriveInitialExaminationStatus` (ST5), `assertValidExaminationName`, `assertValidExamDate`.
- `domain/exam-result.ts` — `assertHasValue` (BR-EXM-01: pelo menos numérico ou texto), `assertValidReferenceRange` (schema.md CHECK), `assertValidParameter`.
- `application/` — `examination-view.ts` (junta `results`+`documentIds`, mesmo critério de `prescriptions/application/prescription-view.ts`); `support.ts` (`auditViewIfNotSelf`; `resolveClinicSnapshot`, duplicado de `appointments/application/support.ts` — mesma forma, módulos só se importam pela raiz); um ficheiro por caso de uso de exame e de resultado; `exam-result-history.ts` (UC-EXM-04, join com `examinations` na `infrastructure`).
- `infrastructure/` — `KyselyExaminationsRepository` + `KyselyExamResultsRepository` (duas tabelas, um módulo).
- `interface/` — as 9 rotas de "Examinations" em `endpoints.md`.

## Migração
`db/migrations/0008_clinics_appointments_examinations.sql`: `examinations`/`exam_results` + `ALTER TABLE documents ADD CONSTRAINT documents_examination_fk ...` (Fase 2 do esquema de `documents`, prevista em `migrations.md`/`0006_documents.sql`).

## Marcação direta com vagas e portal da clínica — exames (ADR-023 revisto 2026-11-04, M7b)
Sem `REQUESTED`/`REJECTED`, sem rota de pedidos e sem job de expiração (BR-EXM-07 obsoleta; `examinations.expire-requests` removido; os valores ficam só no enum de BD, `0022` impõe `CHECK status NOT IN ('REQUESTED','REJECTED')`).
```text
POST /families/{f}/members/{m}/examinations  { slotId }
  → application/create-examination.ts (bookExamInSlot), UMA transação:
    policy.can(CREATE/EXAMS) → clinics.lockSlot (SELECT … FOR UPDATE do clinic_slot)
    → valida kind=EXAM (422), horário existente e futuro (409), clínica ativa
    → existsScheduledForMember (409) → countScheduledBySlot < capacity (senão 409)
    → examinationsRepo.insert(status SCHEDULED, name/data/clínica do horário) → audit EXAM_CREATE {slotId}
PUT /clinic-portal/exam-agenda/{id}/cancel → clinic-examinations.ts: SCHEDULED futuro → CANCELLED + motivo (liberta a vaga, sem lock) + EXAM_CANCELLED
POST /clinic-portal/exam-agenda/{id}/documents → clinic-examinations.ts (upload) → documents.uploadClinicExamDocument
  (resolveTarget corre na transação de `documents`: exame da clínica e SCHEDULED; só PDF; quarentena + ClamAV)
PUT  /clinic-portal/exam-agenda/{id}/complete → clinic-examinations.ts (complete): SCHEDULED→COMPLETED + ≤50 ExamResult na mesma transação
```
- Vagas: a contagem é de exames `SCHEDULED` com o `slotId` (`COMPLETED`/`CANCELLED` não ocupam). Rede de segurança: UNIQUE parcial `(slot_id, member_id) WHERE status='SCHEDULED'` (mesmo membro não ocupa 2 vagas) → o repositório traduz a violação em `CONFLICT`. Não há UNIQUE por horário (N vagas): a garantia anti-overbooking é o bloqueio da linha do horário.
- `update-examination.ts`/`set-examination-status.ts` aplicam BR-EXM-08 (só `notes`; `CANCELLED→SCHEDULED` com `slotId` ⇒ `INVALID_STATE_TRANSITION`).
- Consultas da clínica só devolvem exames com `scheduled_at` (nascidos de um horário); a vista (`ClinicExamView`) nunca inclui valores dos resultados (só `resultsCount`) nem metadados de PDF que não sejam da clínica (`documents.uploadedByClinic`, BR-CLN-03/08). `ClinicExamBooking.slotId`/`professionalName` (opcionais no contrato) ainda não são devolvidos.
- API pública para outros módulos: `countScheduledBySlot` (ocupação de horários `EXAM`, usada por `appointments`/`clinics` via composition root) e `releaseGate` (PDF da clínica só visível ao paciente com o exame `COMPLETED`, usada por `documents`).
- Migrações: `0019` (estados, agora obsoletos), `0020` (tipos de alerta), `0021` (colunas/constraints/índices), `0022` (capacity, fim do fluxo de pedidos, índices de contagem, CHECK `issued_by` corrigida, `documents.uploaded_by_clinic`).

## Rascunho de resultados e laudo gerado (M15 T, ADR-027, BR-CLN-47..49, migração `0031`)
- `application/results-draft.ts`: `GET/PUT/DELETE /clinic-portal/exam-agenda/{id}/results-draft` (tabela `clinic_exam_result_drafts`, um por exame; mesmas validações de BR-CLN-08; o paciente não vê nada; 60 escritas/min por conta; auditoria só com contagens) e `GET …/report/pdf` (a clínica descarrega SÓ o laudo gerado, 30/min; `NOT_FOUND` se apagado).
- `complete` (`application/clinic-examinations.ts`): sem `results` no corpo usa o rascunho (apagado na mesma transação e ao cancelar); com ≥1 resultado e `generateReport≠false` gera o laudo ANTES de qualquer escrita pela porta `ExamReportGenerator` (implementada por `clinic-reports`, ligada em `main/api.ts`) e guarda-o com `documents.storeGenerated` (CLEAN, sem quarentena). Falha ⇒ `INTERNAL_ERROR` e nada muda; se a transação reverter depois de o objeto estar escrito, `documents.discardStored` envia-o para `file_deletions`.
