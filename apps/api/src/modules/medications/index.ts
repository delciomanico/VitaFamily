// Raiz do módulo `medications` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`prescriptions`, `reports` — M6+, modules.md §2) e pelo composition root
// (`main/api.ts`, `main/worker.ts`). M6 (plan.md §4): MedicationPlan, geração de DoseOccurrence
// (DST-aware), ações sobre tomas, adesão (FR-MED). Depende de `access` (autorização por categoria +
// `access.getEffectiveTimezone`, modules.md §2 nota 10) e `audit` — nunca de `families` diretamente
// (ver README.md).
//
// Duas raízes de composição (modules.md §4, mesmo padrão de `documents`): `createMedicationsModule`
// (processo "api": precisa de `access` para autorizar as rotas HTTP) e
// `createMedicationsWorkerModule` (processo "worker": só os jobs `generate-doses`/`mark-unconfirmed`,
// que também precisam de `access.getEffectiveTimezone` — nunca de `policy`, são operações de
// sistema sem ator a autorizar).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { DoseOccurrence } from "./domain/dose-occurrence.js";
import { createCorrectDoseUseCase } from "./application/correct-dose.js";
import { createCreatePlanUseCase, createPlanWithTrx } from "./application/create-plan.js";
import { createDeletePlanUseCase } from "./application/delete-plan.js";
import { createEndPlansForPrescriptionUseCase, createListPlansForPrescriptionUseCase } from "./application/for-prescription.js";
import { createGenerateDosesJobUseCase } from "./application/generate-doses-job.js";
import { createGetPlanUseCase } from "./application/get-plan.js";
import { createListDosesUseCase } from "./application/list-doses.js";
import { createListPlansUseCase } from "./application/list-plans.js";
import { createMarkDoseNotTakenUseCase } from "./application/mark-dose-not-taken.js";
import { createMarkDoseTakenUseCase } from "./application/mark-dose-taken.js";
import { createMarkUnconfirmedJobUseCase } from "./application/mark-unconfirmed-job.js";
import { createMedicationAdherenceUseCase } from "./application/medication-adherence.js";
import type { MedicationsDeps, MedicationsWorkerDeps } from "./application/ports.js";
import { createSetPlanStatusUseCase } from "./application/set-plan-status.js";
import { createUpdatePlanUseCase } from "./application/update-plan.js";
import { KyselyDoseOccurrencesRepository, KyselyMedicationPlansRepository } from "./infrastructure/repo.js";
import { registerGenerateDosesWorker, registerMarkUnconfirmedWorker } from "./infrastructure/jobs.js";
import { createMedicationsRouter, type MedicationsController } from "./interface/router.js";

export type { DoseOccurrence, DoseStatus } from "./domain/dose-occurrence.js";
export type { MedicationPlan, PlanStatus, ScheduleType } from "./domain/medication-plan.js";
export type { CreateMedicationPlanInput, CreateMedicationPlanOptions } from "./application/create-plan.js";

export interface MedicationsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
}

export interface MedicationsModule {
  router: Router;
  /** API pública para `prescriptions` (modules.md §3.6) — recebem `trx` já aberto. */
  createPlan: ReturnType<typeof createPlanWithTrx<Kysely<Database>>>;
  listPlansForPrescription: ReturnType<typeof createListPlansForPrescriptionUseCase<Kysely<Database>>>;
  endPlansForPrescription: ReturnType<typeof createEndPlansForPrescriptionUseCase<Kysely<Database>>>;
}

function buildDeps(deps: MedicationsModuleDeps): MedicationsDeps<Kysely<Database>> {
  return {
    plansRepo: new KyselyMedicationPlansRepository(),
    dosesRepo: new KyselyDoseOccurrencesRepository(),
    policy: deps.access.policy,
    timezone: { getEffectiveTimezone: deps.access.getEffectiveTimezone },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
}

/** Composition root do processo "api" (main/api.ts). */
export function createMedicationsModule(deps: MedicationsModuleDeps): MedicationsModule {
  const medicationsDeps = buildDeps(deps);

  const controller: MedicationsController = {
    listPlans: createListPlansUseCase(medicationsDeps),
    createPlan: createCreatePlanUseCase(medicationsDeps),
    getPlan: createGetPlanUseCase(medicationsDeps),
    updatePlan: createUpdatePlanUseCase(medicationsDeps),
    setPlanStatus: createSetPlanStatusUseCase(medicationsDeps),
    deletePlan: createDeletePlanUseCase(medicationsDeps),
    listDoses: createListDosesUseCase(medicationsDeps),
    markDoseTaken: createMarkDoseTakenUseCase(medicationsDeps),
    markDoseNotTaken: createMarkDoseNotTakenUseCase(medicationsDeps),
    correctDose: createCorrectDoseUseCase(medicationsDeps),
    medicationAdherence: createMedicationAdherenceUseCase(medicationsDeps),
  };

  return {
    router: createMedicationsRouter(controller),
    createPlan: createPlanWithTrx(medicationsDeps),
    listPlansForPrescription: createListPlansForPrescriptionUseCase(medicationsDeps),
    endPlansForPrescription: createEndPlansForPrescriptionUseCase(medicationsDeps),
  };
}

export interface MedicationsWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
  boss: PgBoss;
}

export interface MedicationsWorkerModule {
  /** Regista `medications.generate-doses` (diário, DM5) e `medications.mark-unconfirmed` (5 min, Q2). */
  registerWorkers: () => Promise<string[]>;
  /** API pública para `alerts.scan` consumir pela raiz (modules.md §3 nota 3, M8): candidatas a
   * `dose.due`/`dose.repeat` — `alerts` nunca acede a `dose_occurrences` diretamente. */
  listReminderCandidates: (trx: Kysely<Database>, now: Date, limit: number) => Promise<DoseOccurrence[]>;
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createMedicationsWorkerModule(deps: MedicationsWorkerModuleDeps): MedicationsWorkerModule {
  const medicationsDeps: MedicationsWorkerDeps<Kysely<Database>> = buildDeps({ db: deps.db, audit: deps.audit, access: deps.access, clock: deps.clock });
  const generateDosesJob = createGenerateDosesJobUseCase(medicationsDeps);
  const markUnconfirmedJob = createMarkUnconfirmedJobUseCase(medicationsDeps);

  return {
    registerWorkers: async () => [
      await registerGenerateDosesWorker(deps.boss, generateDosesJob),
      await registerMarkUnconfirmedWorker(deps.boss, markUnconfirmedJob),
    ],
    listReminderCandidates: (trx, now, limit) => medicationsDeps.dosesRepo.listReminderCandidates(trx, now, limit),
  };
}
