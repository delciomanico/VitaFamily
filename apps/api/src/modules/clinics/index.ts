// Raiz do módulo `clinics` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos (`appointments`, `examinations`, `reports` — M7+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Clinic PARTNER/PRIVATE, incluindo a gestão de parceiras
// (FR-CLN, FR-ADM-01). Depende só de `access`/`audit` (modules.md §2) — ver `README.md` para a
// decisão de change control que expõe `access.getMembershipFacts` (modules.md §3 nota 11) em vez
// de uma aresta nova `clinics` → `families`.
//
// D17/D18 (ADR-020, discovery.md): acrescenta a identidade do Portal da Clínica Parceira
// (`ClinicAccount`/`clinic_sessions`), TOTALMENTE separada de `User` — decisão de onde este código
// vive (`README.md` "Portal da clínica"): dentro de `clinics` (não um módulo novo), porque já
// depende só de `access`/`audit` e já expõe `/admin/clinics...`; o portal só acrescenta mais um
// router (`clinicPortalRouter`, `/clinic-portal/auth/*`) e mais um par (security handler + actor
// context middleware), sem nenhuma aresta nova no grafo de módulos.
//
// Expõe QUATRO routers: `router` (`/families/{familyId}/clinics...`, UC-CLN-01/02/03),
// `adminRouter` (`/admin/clinics...`, UC-ADM-03 + `root-account`, D18) e `clinicPortalRouter`
// (`/clinic-portal/auth/*`, D17/D18) — `adminRouter` substitui, por agora, as rotas que um módulo
// `admin` (M9, ainda inexistente nesta parte) delegaria em `clinics`; `main/api.ts` monta todos
// diretamente.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { Logger } from "../../platform/logger/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import {
  createAdminListClinicAccountsUseCase,
  createAdminReactivateClinicAccountUseCase,
  createAdminSuspendClinicAccountUseCase,
} from "./application/admin-clinic-accounts.js";
import {
  createAdminClinicRootAccountUseCase,
  createAdminCreateClinicUseCase,
  createAdminListClinicsUseCase,
  createAdminSetClinicStatusUseCase,
  createAdminUpdateClinicUseCase,
} from "./application/admin-clinics.js";
import {
  createFindClinicSlotByIdUseCase,
  createFindClinicSlotUseCase,
  createListFreeClinicSlotsUseCase,
  createListOwnClinicSlotsUseCase,
  createLockClinicSlotUseCase,
  createPublishClinicSlotsUseCase,
  createRemoveClinicSlotUseCase,
  createUpdateClinicSlotUseCase,
} from "./application/clinic-slots.js";
import { createClinicLoginUseCase } from "./application/clinic-login.js";
import { createClinicLogoutUseCase } from "./application/clinic-logout.js";
import { createClinicRefreshUseCase } from "./application/clinic-refresh.js";
import { createCreatePrivateClinicUseCase } from "./application/create-private-clinic.js";
import { createDeletePrivateClinicUseCase } from "./application/delete-private-clinic.js";
import { createGetBookableClinicUseCase } from "./application/get-bookable-clinic.js";
import { createListClinicsUseCase } from "./application/list-clinics.js";
import { createCreateClinicStaffUseCase, createListClinicStaffUseCase, createRemoveClinicStaffUseCase } from "./application/manage-clinic-staff.js";
import type { ClinicMailer, ClinicsDeps, SlotBookingCountRow } from "./application/ports.js";
import { createResolveClinicActorStateUseCase } from "./application/resolve-clinic-actor-state.js";
import { createSetPrivateClinicStatusUseCase } from "./application/set-private-clinic-status.js";
import { createUpdatePrivateClinicUseCase } from "./application/update-private-clinic.js";
import type { ClinicSigningKey } from "./domain/clinic-jwt.js";
import { ClinicInMemoryRateLimiter } from "./domain/clinic-rate-limiter.js";
import { ClinicTtlCache } from "./domain/clinic-ttl-cache.js";
import { KyselyClinicAccountRepository, KyselyClinicSessionRepository } from "./infrastructure/clinic-account-repo.js";
import { KyselyClinicSlotsRepository } from "./infrastructure/clinic-slots-repo.js";
import { KyselyClinicsRepository } from "./infrastructure/repo.js";
import { createClinicsAdminRouter, type ClinicsAdminController } from "./interface/admin-router.js";
import {
  createClinicActorContextMiddleware,
  createClinicBearerAuthSecurityHandler,
} from "./interface/clinic-portal-middleware.js";
import { createClinicPortalRouter, type ClinicPortalController } from "./interface/clinic-portal-router.js";
import { createClinicsRouter, type ClinicsController } from "./interface/router.js";

export type { Clinic, ClinicStatus, ClinicType } from "./domain/clinic.js";
export type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "./domain/clinic-account.js";
export { parseClinicSigningKeys, type ClinicSigningKey } from "./domain/clinic-jwt.js";
export type { ClinicSlot, ClinicSlotState } from "./domain/clinic-slot.js";
export type { AdminClinicAccountView, SuspendClinicAccountInput } from "./application/admin-clinic-accounts.js";
export type { SlotBookingCountRow } from "./application/ports.js";
export { ClinicSmtpMailer } from "./infrastructure/clinic-mailer-smtp.js";
export { ClinicFakeMailer } from "./infrastructure/clinic-mailer-fake.js";

/** Cache do estado da conta do portal por pedido (authorization.md §6.1, mesmo critério ≤60 s de `auth`). */
const CLINIC_ACCOUNT_STATE_CACHE_TTL_MS = 60_000;

export interface ClinicsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
  // Portal da clínica (D17/D18, ADR-020):
  clinicMailer: ClinicMailer;
  logger: Logger;
  clinicSigningKeys: ClinicSigningKey[];
  clinicAccessTtlSeconds: number;
  clinicRefreshTtlMs: number;
  cookieDomain: string;
  /** BR-CLN-04: ocupação de horários por consultas/exames ativos — ligada no composition root. */
  slotOccupancy: ClinicsSlotOccupancy;
}

export interface ClinicsSlotOccupancy {
  countActiveBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<SlotBookingCountRow[]>;
}

export interface ClinicsModule {
  router: Router;
  adminRouter: Router;
  /** `/clinic-portal/auth/*` (D17/D18, ADR-020). */
  clinicPortalRouter: Router;
  /** Handler de segurança `clinicBearerAuth` (`createApp({ securityHandlers })`). */
  clinicSecurityHandlers: { clinicBearerAuth: ReturnType<typeof createClinicBearerAuthSecurityHandler> };
  /** Middleware a montar a seguir ao de `auth` (preenche o SEGUNDO `platform/actor`, ADR-020). */
  clinicActorContextMiddleware: ReturnType<typeof createClinicActorContextMiddleware>;
  /** API pública para `appointments`/`examinations` (modules.md §2: `ClinicLookup`). */
  getBookableClinic: ReturnType<typeof createGetBookableClinicUseCase<Kysely<Database>>>;
  /** API pública de `ClinicSlot` (Fase C), consumida por `appointments` desde a Fase D (D17,
   * `application/ports.ts#ClinicsPort`): horários livres de uma clínica e consulta de um horário
   * concreto. */
  listFreeClinicSlots: ReturnType<typeof createListFreeClinicSlotsUseCase<Kysely<Database>>>;
  findClinicSlot: ReturnType<typeof createFindClinicSlotUseCase<Kysely<Database>>>;
  /** D19 (UC-EXM-08), consumida por `examinations`: horário pelo id (o pedido de exame não traz `clinicId`). */
  findClinicSlotById: ReturnType<typeof createFindClinicSlotByIdUseCase<Kysely<Database>>>;
  /** BR-APT-11 (`examinations`): bloqueia o horário (`FOR UPDATE`) na transação do chamador. */
  lockClinicSlot: ReturnType<typeof createLockClinicSlotUseCase<Kysely<Database>>>;
  /** Para `admin` (BR-ADM-03/04, ADR-023): listar, suspender e reativar contas do portal de uma clínica parceira. */
  adminListClinicAccounts: ReturnType<typeof createAdminListClinicAccountsUseCase<Kysely<Database>>>;
  adminSuspendClinicAccount: ReturnType<typeof createAdminSuspendClinicAccountUseCase<Kysely<Database>>>;
  adminReactivateClinicAccount: ReturnType<typeof createAdminReactivateClinicAccountUseCase<Kysely<Database>>>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createClinicsModule(deps: ClinicsModuleDeps): ClinicsModule {
  const clinicsRepo = new KyselyClinicsRepository();
  const clinicAccountRepo = new KyselyClinicAccountRepository();
  const clinicSessionRepo = new KyselyClinicSessionRepository();
  const clinicSlotsRepo = new KyselyClinicSlotsRepository();
  const clinicRateLimiter = new ClinicInMemoryRateLimiter(deps.clock);
  const clinicAccountStateCache = new ClinicTtlCache<{
    clinicId: string;
    role: "CLINIC_ADMIN" | "CLINIC_MANAGER";
    suspended: boolean;
  }>(deps.clock, CLINIC_ACCOUNT_STATE_CACHE_TTL_MS);

  const clinicsDeps: ClinicsDeps<Kysely<Database>> = {
    clinicsRepo,
    access: { getMembershipFacts: deps.access.getMembershipFacts },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    clinicAccountRepo,
    clinicSessionRepo,
    clinicSlotsRepo,
    slotOccupancy: deps.slotOccupancy,
    clinicMailer: deps.clinicMailer,
    logger: deps.logger,
    clinicRateLimiter,
    clinicSigningKeys: deps.clinicSigningKeys,
    clinicAccessTtlSeconds: deps.clinicAccessTtlSeconds,
    clinicRefreshTtlMs: deps.clinicRefreshTtlMs,
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
    adminCreateOrResetClinicRootAccount: createAdminClinicRootAccountUseCase(clinicsDeps),
  };

  const resolveClinicActorState = createResolveClinicActorStateUseCase(clinicsDeps, clinicAccountStateCache);

  const clinicPortalController: ClinicPortalController = {
    clinicLogin: createClinicLoginUseCase(clinicsDeps),
    clinicRefresh: createClinicRefreshUseCase(clinicsDeps),
    clinicLogout: createClinicLogoutUseCase(clinicsDeps),
    listClinicStaff: createListClinicStaffUseCase(clinicsDeps),
    createClinicStaff: createCreateClinicStaffUseCase(clinicsDeps),
    removeClinicStaff: createRemoveClinicStaffUseCase(clinicsDeps),
    listOwnClinicSlots: createListOwnClinicSlotsUseCase(clinicsDeps),
    publishClinicSlots: createPublishClinicSlotsUseCase(clinicsDeps),
    updateClinicSlot: createUpdateClinicSlotUseCase(clinicsDeps),
    removeClinicSlot: createRemoveClinicSlotUseCase(clinicsDeps),
  };

  return {
    router: createClinicsRouter(controller),
    adminRouter: createClinicsAdminRouter(adminController),
    clinicPortalRouter: createClinicPortalRouter(clinicPortalController, deps.cookieDomain),
    clinicSecurityHandlers: {
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({
        signingKeys: deps.clinicSigningKeys,
        clock: deps.clock,
      }),
    },
    clinicActorContextMiddleware: createClinicActorContextMiddleware({ resolveClinicActorState }),
    getBookableClinic: createGetBookableClinicUseCase(clinicsDeps),
    listFreeClinicSlots: createListFreeClinicSlotsUseCase(clinicsDeps),
    findClinicSlot: createFindClinicSlotUseCase(clinicsDeps),
    findClinicSlotById: createFindClinicSlotByIdUseCase(clinicsDeps),
    lockClinicSlot: createLockClinicSlotUseCase(clinicsDeps),
    adminListClinicAccounts: createAdminListClinicAccountsUseCase(clinicsDeps),
    adminSuspendClinicAccount: createAdminSuspendClinicAccountUseCase(clinicsDeps),
    adminReactivateClinicAccount: createAdminReactivateClinicAccountUseCase(clinicsDeps),
  };
}
