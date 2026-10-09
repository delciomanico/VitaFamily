// Raiz do módulo `health-records` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos e pelo composition root (`main/api.ts`). M4 (plan.md §4): Allergy,
// MedicalCondition, tipo sanguíneo (FR-HP). Depende de `access` (autorização por categoria,
// `access.policy.can()`), `audit` (auditoria das escritas e das leituras por quem não é o
// titular) e `families` (modules.md §3 nota 9: `blood_type` vive em `family_members`, lido/escrito
// só pela API pública de `families`). Não expõe nada a outros módulos no MVP (modules.md §2).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { FamiliesModule } from "../families/index.js";
import { createCreateAllergyUseCase } from "./application/create-allergy.js";
import { createCreateConditionUseCase } from "./application/create-condition.js";
import { createDeleteAllergyUseCase } from "./application/delete-allergy.js";
import { createDeleteConditionUseCase } from "./application/delete-condition.js";
import { createGetBloodTypeUseCase } from "./application/get-blood-type.js";
import { createListAllergiesUseCase } from "./application/list-allergies.js";
import { createListConditionsUseCase } from "./application/list-conditions.js";
import type { HealthRecordsDeps } from "./application/ports.js";
import { createPutBloodTypeUseCase } from "./application/put-blood-type.js";
import { createUpdateAllergyUseCase } from "./application/update-allergy.js";
import { createUpdateConditionUseCase } from "./application/update-condition.js";
import { KyselyAllergiesRepository, KyselyMedicalConditionsRepository } from "./infrastructure/repo.js";
import { createHealthRecordsRouter, type HealthRecordsController } from "./interface/router.js";

export type { Allergy } from "./domain/allergy.js";
export type { BloodType } from "./domain/blood-type.js";
export type { ConditionKind, MedicalCondition } from "./domain/medical-condition.js";

export interface HealthRecordsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  families: FamiliesModule;
  clock: Clock;
}

export interface HealthRecordsModule {
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createHealthRecordsModule(deps: HealthRecordsModuleDeps): HealthRecordsModule {
  const allergiesRepo = new KyselyAllergiesRepository();
  const conditionsRepo = new KyselyMedicalConditionsRepository();

  const healthRecordsDeps: HealthRecordsDeps<Kysely<Database>> = {
    allergiesRepo,
    conditionsRepo,
    familiesPort: {
      getBloodType: deps.families.getBloodType,
      setBloodType: deps.families.setBloodType,
    },
    policy: deps.access.policy,
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: HealthRecordsController = {
    getBloodType: createGetBloodTypeUseCase(healthRecordsDeps),
    putBloodType: createPutBloodTypeUseCase(healthRecordsDeps),
    listAllergies: createListAllergiesUseCase(healthRecordsDeps),
    createAllergy: createCreateAllergyUseCase(healthRecordsDeps),
    updateAllergy: createUpdateAllergyUseCase(healthRecordsDeps),
    deleteAllergy: createDeleteAllergyUseCase(healthRecordsDeps),
    listConditions: createListConditionsUseCase(healthRecordsDeps),
    createCondition: createCreateConditionUseCase(healthRecordsDeps),
    updateCondition: createUpdateConditionUseCase(healthRecordsDeps),
    deleteCondition: createDeleteConditionUseCase(healthRecordsDeps),
  };

  return { router: createHealthRecordsRouter(controller) };
}
