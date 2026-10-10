# Módulo `prescriptions`

M6 (`plan.md` §4): `Prescription` e orquestração com `medications` (FR-RX). Depende de `access`, `medications`, `documents`, `audit` (modules.md §2) — **nunca** o inverso (`medications`/`documents` nunca importam `prescriptions`, modules.md §3.6: "ciclos proibidos — a orquestração fica em `prescriptions`").

## Mapa de um pedido típico

```
POST /families/{familyId}/members/{memberId}/prescriptions
  → interface/router.ts
    → application/create-prescription.ts   # valida issuedOn (BR-RX-01) e ≥1 medicamento
      → access/index.js (policy.can)        #   CREATE/MEDICATION
        → infrastructure/repo.ts (insert)   # linha de `prescriptions`
          → medications/index.js (createPlan) × N  # um MedicationPlan por medicamento, MESMA transação
            → audit.record(trx, …)          # PRESCRIPTION_CREATE
              → application/prescription-view.ts  # junta medications+documentIds para a resposta
```

```
DELETE /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}
  → application/delete-prescription.ts     # BR-RX-06
    → documents/index.js (deleteAllForResource)  # outbox de ficheiros ANTES de apagar as linhas
      → infrastructure/repo.ts (delete)          # CASCADE apaga medication_plans/dose_occurrences (sem storage externo)
        → audit.record(trx, …)                   # PRESCRIPTION_DELETE
```

## Camadas presentes
- `domain/` — `prescription.ts`: `assertValidIssuedOn` (BR-RX-01: obrigatória, não futura), `assertHasMedications` (≥1), `assertValidPrescriptionTransition` (ST1).
- `application/` — um ficheiro por caso de uso; `prescription-view.ts` (junta `medications`/`documentIds`, nenhum dos dois vive na tabela `prescriptions`); `support.ts` (`auditViewIfNotSelf`, audit.md §3); `add-prescription-medication.ts`/`set-prescription-status.ts` chamam a API pública de `medications` (`createPlan`/`endPlansForPrescription`) pela raiz, na mesma transação.
- `infrastructure/` — `KyselyPrescriptionsRepository` (só a tabela `prescriptions`; `medication_plans`/`dose_occurrences` são de `medications`, conventions.md §3.5).
- `interface/` — as 7 rotas de "Prescriptions" em `endpoints.md`. `toEmbeddedMedicationPlan` (dto.ts) duplica de propósito o mapeamento de `medications/interface/dto.ts`: um módulo só se importa pela raiz (`medications/index.ts` não expõe a camada `interface` de outro módulo) — função pura pequena, mesmo critério de `BloodType` em `health-records/README.md`.

## Decisões de desenho
1. **Eliminação (BR-RX-06):** `documents.deleteAllForResource` corre **antes** de apagar a linha de `prescriptions` — a cascata de FK (`medication_plans`/`dose_occurrences`, sem armazenamento externo) é suficiente para esses dois, mas documentos têm ficheiros em MinIO: apagar por CASCADE bruto deixaria o outbox de apagamento por acionar (órfãos no armazenamento). Mesmo critério já documentado em `documents/README.md`/`migrations.md`.
2. **Reabrir não reativa planos (ST1):** `setPrescriptionStatus` só chama `medications.endPlansForPrescription` ao concluir/cancelar; ao reabrir (`COMPLETED`/`CANCELLED` → `ACTIVE`) não toca nos planos — quem quiser retomar a medicação reativa cada plano via `PUT .../medication-plans/{id}/status` (entities.md: "reabrir não recria tomas passadas; o plano só retoma se for reativado").
3. **Autorização redundante, mas segura:** `addPrescriptionMedication` chama `access.policy.can()` (UPDATE/MEDICATION) e depois `medications.createPlan` (que decide CREATE/MEDICATION outra vez) — authorization.md §5.1 exige que toda rota de negócio chame a política; a dupla chamada é inofensiva (mesma relação, mesmo resultado).

## Migração
`db/migrations/0007_prescriptions_and_medications.sql`: `prescriptions` (+ `medication_plans`/`dose_occurrences`, ver `medications/README.md`) e a Fase 2 de `documents` (`ALTER TABLE documents ADD CONSTRAINT documents_prescription_fk ...`, prevista em `migrations.md`/`0006_documents.sql`).
