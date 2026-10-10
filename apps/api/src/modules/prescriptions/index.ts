// Raiz do módulo `prescriptions` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`reports` — M9) e pelo composition root (`main/api.ts`). M6 (plan.md §4):
// Prescription e orquestração com `medications` (modules.md §3.6: "a orquestração fica em
// `prescriptions`, que chama `medications`" — nunca o inverso). Depende de `access`, `medications`,
// `documents`, `audit` (modules.md §2).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { DocumentsModule } from "../documents/index.js";
import type { MedicationsModule } from "../medications/index.js";
import { createAddPrescriptionMedicationUseCase } from "./application/add-prescription-medication.js";
import { createCreatePrescriptionUseCase } from "./application/create-prescription.js";
import { createDeletePrescriptionUseCase } from "./application/delete-prescription.js";
import { createGetPrescriptionUseCase } from "./application/get-prescription.js";
import { createListPrescriptionsUseCase } from "./application/list-prescriptions.js";
import type { PrescriptionsDeps } from "./application/ports.js";
import { createSetPrescriptionStatusUseCase } from "./application/set-prescription-status.js";
import { createUpdatePrescriptionUseCase } from "./application/update-prescription.js";
import { KyselyPrescriptionsRepository } from "./infrastructure/repo.js";
import { createPrescriptionsRouter, type PrescriptionsController } from "./interface/router.js";

export type { Prescription, PrescriptionStatus } from "./domain/prescription.js";

export interface PrescriptionsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  medications: MedicationsModule;
  documents: DocumentsModule;
  clock: Clock;
}

export interface PrescriptionsModule {
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createPrescriptionsModule(deps: PrescriptionsModuleDeps): PrescriptionsModule {
  const prescriptionsRepo = new KyselyPrescriptionsRepository();

  const prescriptionsDeps: PrescriptionsDeps<Kysely<Database>> = {
    prescriptionsRepo,
    policy: deps.access.policy,
    medications: {
      createPlan: deps.medications.createPlan,
      listPlansForPrescription: deps.medications.listPlansForPrescription,
      endPlansForPrescription: deps.medications.endPlansForPrescription,
    },
    documents: {
      listForResource: deps.documents.listForResource,
      deleteAllForResource: deps.documents.deleteAllForResource,
    },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: PrescriptionsController = {
    listPrescriptions: createListPrescriptionsUseCase(prescriptionsDeps),
    createPrescription: createCreatePrescriptionUseCase(prescriptionsDeps),
    getPrescription: createGetPrescriptionUseCase(prescriptionsDeps),
    updatePrescription: createUpdatePrescriptionUseCase(prescriptionsDeps),
    deletePrescription: createDeletePrescriptionUseCase(prescriptionsDeps),
    setPrescriptionStatus: createSetPrescriptionStatusUseCase(prescriptionsDeps),
    addPrescriptionMedication: createAddPrescriptionMedicationUseCase(prescriptionsDeps),
  };

  return { router: createPrescriptionsRouter(controller) };
}
