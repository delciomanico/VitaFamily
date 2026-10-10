// Raiz do módulo `clinics` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos (`appointments`, `examinations`, `reports` — M7+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Clinic PARTNER/PRIVATE, incluindo a gestão de parceiras
// (FR-CLN, FR-ADM-01). Depende só de `access` (modules.md §2) — ver `README.md` para a decisão de
// change control que expõe `access.getMembershipFacts` (modules.md §3 nota 11) em vez de uma
// aresta nova `clinics` → `families`.
//
// Expõe DOIS routers (ver `README.md`): `router` (`/families/{familyId}/clinics...`, UC-CLN-01/02/
// 03) e `adminRouter` (`/admin/clinics...`, UC-ADM-03) — este último substitui, por agora, as
// rotas que um módulo `admin` (M9, ainda inexistente) delegaria em `clinics` (modules.md: "clinics…
// inclui a gestão de parceiras, exposta pelo admin através da API de clinics"); `main/api.ts` monta
// os dois diretamente.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import { createAdminCreateClinicUseCase, createAdminListClinicsUseCase, createAdminSetClinicStatusUseCase, createAdminUpdateClinicUseCase } from "./application/admin-clinics.js";
import { createCreatePrivateClinicUseCase } from "./application/create-private-clinic.js";
import { createDeletePrivateClinicUseCase } from "./application/delete-private-clinic.js";
import { createGetBookableClinicUseCase } from "./application/get-bookable-clinic.js";
import { createListClinicsUseCase } from "./application/list-clinics.js";
import type { ClinicsDeps } from "./application/ports.js";
import { createSetPrivateClinicStatusUseCase } from "./application/set-private-clinic-status.js";
import { createUpdatePrivateClinicUseCase } from "./application/update-private-clinic.js";
import { KyselyClinicsRepository } from "./infrastructure/repo.js";
import { createClinicsAdminRouter, type ClinicsAdminController } from "./interface/admin-router.js";
import { createClinicsRouter, type ClinicsController } from "./interface/router.js";

export type { Clinic, ClinicStatus, ClinicType } from "./domain/clinic.js";

export interface ClinicsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
}

export interface ClinicsModule {
  router: Router;
  adminRouter: Router;
  /** API pública para `appointments`/`examinations` (modules.md §2: `ClinicLookup`). */
  getBookableClinic: ReturnType<typeof createGetBookableClinicUseCase<Kysely<Database>>>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createClinicsModule(deps: ClinicsModuleDeps): ClinicsModule {
  const clinicsRepo = new KyselyClinicsRepository();

  const clinicsDeps: ClinicsDeps<Kysely<Database>> = {
    clinicsRepo,
    access: { getMembershipFacts: deps.access.getMembershipFacts },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: ClinicsController = {
    listClinics: createListClinicsUseCase(clinicsDeps),
    createPrivateClinic: createCreatePrivateClinicUseCase(clinicsDeps),
    updatePrivateClinic: createUpdatePrivateClinicUseCase(clinicsDeps),
    setPrivateClinicStatus: createSetPrivateClinicStatusUseCase(clinicsDeps),
    deletePrivateClinic: createDeletePrivateClinicUseCase(clinicsDeps),
  };

  const adminController: ClinicsAdminController = {
    adminListClinics: createAdminListClinicsUseCase(clinicsDeps),
    adminCreateClinic: createAdminCreateClinicUseCase(clinicsDeps),
    adminUpdateClinic: createAdminUpdateClinicUseCase(clinicsDeps),
    adminSetClinicStatus: createAdminSetClinicStatusUseCase(clinicsDeps),
  };

  return {
    router: createClinicsRouter(controller),
    adminRouter: createClinicsAdminRouter(adminController),
    getBookableClinic: createGetBookableClinicUseCase(clinicsDeps),
  };
}
