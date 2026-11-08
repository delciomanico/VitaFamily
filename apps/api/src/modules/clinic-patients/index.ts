// Raiz do módulo `clinic-patients` (ADR-015/conventions.md §1, M14 P, ADR-026, modules.md §2 nota 24): registo de
// pacientes da clínica (`ClinicPatient`), ligação a membros Vita, consentimento por clínica, código/QR de ligação e
// visitas presenciais manuais; rotas `/clinic-portal/patients*|search|calendar` (ator `ClinicAccount`) e
// `/families/{f}/members/{m}/clinic-consents*|clinic-link-codes` (ator `User`, `AccessPolicy`).
// NÃO importa os módulos de saúde: tudo o que precisa de dados Vita entra por PORTAS (`application/ports.ts`) ligadas no
// composition root (`main/api.ts`). Importa `access` (política e nome do membro), `clinics` (horários/profissionais/clínica
// parceira) e `audit`.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import { createGetClinicCalendarUseCase, createClinicGlobalSearchUseCase } from "./application/calendar.js";
import {
  createCreateClinicLinkCodeUseCase,
  createListClinicConsentsUseCase,
  createPutClinicConsentUseCase,
  createRevokeClinicConsentUseCase,
} from "./application/consents.js";
import { createCountActiveVisitsBySlotUseCase, createEnsureLinkedByEmailUseCase, createFindPatientIdsByMembersUseCase, createResolvePatientUseCase } from "./application/directory.js";
import { createLinkClinicPatientUseCase } from "./application/patient-link.js";
import { createCreateClinicPatientUseCase, createGetClinicPatientUseCase, createListClinicPatientsUseCase, createUpdateClinicPatientUseCase } from "./application/patients.js";
import type {
  CalendarSourcePort,
  ClinicPatientsDeps,
  RecommendationsSourcePort,
  SharedHistoryReaderPort,
  SlotFacts,
  SlotReservationPort,
} from "./application/ports.js";
import { createPurgeLinkCodesJobUseCase } from "./application/purge-link-codes.js";
import { createGetClinicPatientRecordUseCase } from "./application/record.js";
import { createGetSharedHistoryUseCase } from "./application/shared-history.js";
import { createBookVisitUseCase, createCancelVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "./application/visits.js";
import { InMemoryRateLimiter, type RateLimiter } from "./domain/rate-limiter.js";
import { registerPurgeLinkCodesWorker } from "./infrastructure/jobs.js";
import { KyselyConsentsRepository, KyselyLinkCodesRepository, KyselyLinksRepository, KyselyPatientsRepository, KyselyVisitsRepository } from "./infrastructure/repo.js";
import { createClinicPatientsFamilyRouter, type ClinicPatientsFamilyController } from "./interface/family-router.js";
import { createClinicPatientsPortalRouter, type ClinicPatientsPortalController } from "./interface/portal-router.js";

export type { CalendarSourcePort, RecommendationsSourcePort, SharedHistoryReaderPort, AppointmentFact, ExaminationFact, RecommendationFact, SharedExam, SharedMedication } from "./application/ports.js";
export type { RateLimiter } from "./domain/rate-limiter.js";

/** Ocupação de horários por consultas e exames (ligada no composition root a `appointments`+`examinations`). */
export interface ClinicPatientsSlotOccupancy {
  countActiveBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<{ slotId: string; requested: number; scheduled: number }[]>;
}

export interface ClinicPatientsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clinics: Pick<
    ClinicsModule,
    "getPartnerClinic" | "lockClinicSlot" | "listClinicSlotsInWindow" | "findClinicSlotsByIds" | "findClinicProfessional" | "listProfessionalSlotsOverlapping"
  >;
  occupancy: ClinicPatientsSlotOccupancy;
  sharedHistory: SharedHistoryReaderPort<Kysely<Database>>;
  calendar: CalendarSourcePort<Kysely<Database>>;
  recommendations: RecommendationsSourcePort<Kysely<Database>>;
  /** BR-CLN-20: o MESMO limiter do walk-in (chaves `walk-in:*`), para o limite ser partilhado (BR-CLN-10). */
  sharedLimiter: RateLimiter;
  /** `CLINIC_LINK_CODE_SECRET` (BR-CLN-20). */
  linkCodeSecret: string;
  clock: Clock;
}

function toSlotFacts(slot: {
  id: string;
  clinicId: string;
  kind: "APPOINTMENT" | "EXAM";
  specialty: string;
  professionalId?: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
}): SlotFacts {
  return {
    id: slot.id,
    clinicId: slot.clinicId,
    kind: slot.kind,
    specialty: slot.specialty,
    startsAt: slot.startsAt,
    durationMinutes: slot.durationMinutes,
    capacity: slot.capacity,
    ...(slot.professionalId ? { professionalId: slot.professionalId } : {}),
    ...(slot.professionalName ? { professionalName: slot.professionalName } : {}),
  };
}

export interface ClinicPatientsModule {
  /** `/families/{f}/members/{m}/clinic-consents*` e `clinic-link-codes` (ator `User`). */
  router: Router;
  /** `/clinic-portal/patients*`, `/search`, `/calendar` (ator `ClinicAccount`, ADR-020). */
  clinicPortalRouter: Router;
  /** `ClinicPatientDirectory` — porta definida por `appointments` (walk-in), implementada aqui. */
  directory: {
    resolvePatient: ReturnType<typeof createResolvePatientUseCase<Kysely<Database>>>;
    ensureLinkedByEmail: ReturnType<typeof createEnsureLinkedByEmailUseCase<Kysely<Database>>>;
    bookVisit: ReturnType<typeof createBookVisitUseCase<Kysely<Database>>>;
    listVisits: ReturnType<typeof createListVisitsUseCase<Kysely<Database>>>;
    cancelVisit: ReturnType<typeof createCancelVisitUseCase<Kysely<Database>>>;
    completeVisit: ReturnType<typeof createCompleteVisitUseCase<Kysely<Database>>>;
    countActiveVisitsBySlot: ReturnType<typeof createCountActiveVisitsBySlotUseCase<Kysely<Database>>>;
    findPatientIdsByMembers: ReturnType<typeof createFindPatientIdsByMembersUseCase<Kysely<Database>>>;
  };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createClinicPatientsModule(deps: ClinicPatientsModuleDeps): ClinicPatientsModule {
  const slots: SlotReservationPort<Kysely<Database>> = {
    lockSlot: async (trx, slotId) => {
      const slot = await deps.clinics.lockClinicSlot(trx, slotId);
      return slot ? toSlotFacts(slot) : null;
    },
    listSlots: async (trx, clinicId, window) => (await deps.clinics.listClinicSlotsInWindow(trx, clinicId, window.from, window.to)).map(toSlotFacts),
    findSlotsByIds: async (trx, clinicId, slotIds) => (await deps.clinics.findClinicSlotsByIds(trx, clinicId, slotIds)).map(toSlotFacts),
    countActiveBySlot: (trx, slotIds) => deps.occupancy.countActiveBySlot(trx, slotIds),
    listProfessionalSlotsOverlapping: (trx, professionalId, from, to, excludeSlotId) => deps.clinics.listProfessionalSlotsOverlapping(trx, professionalId, from, to, excludeSlotId),
    findProfessional: (trx, clinicId, professionalId) => deps.clinics.findClinicProfessional(trx, clinicId, professionalId),
  };

  const clinicPatientsDeps: ClinicPatientsDeps<Kysely<Database>> = {
    patientsRepo: new KyselyPatientsRepository(),
    linksRepo: new KyselyLinksRepository(),
    consentsRepo: new KyselyConsentsRepository(),
    codesRepo: new KyselyLinkCodesRepository(),
    visitsRepo: new KyselyVisitsRepository(),
    policy: deps.access.policy,
    members: { getMemberName: deps.access.getMemberName },
    clinics: { findPartnerClinic: (trx, clinicId) => deps.clinics.getPartnerClinic(trx, clinicId) },
    sharedHistory: deps.sharedHistory,
    calendar: deps.calendar,
    recommendations: deps.recommendations,
    slots,
    searchLimiter: new InMemoryRateLimiter(deps.clock),
    sharedLimiter: deps.sharedLimiter,
    audit: deps.audit,
    linkCodeSecret: deps.linkCodeSecret,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const familyController: ClinicPatientsFamilyController = {
    listClinicConsents: createListClinicConsentsUseCase(clinicPatientsDeps),
    putClinicConsent: createPutClinicConsentUseCase(clinicPatientsDeps),
    revokeClinicConsent: createRevokeClinicConsentUseCase(clinicPatientsDeps),
    createClinicLinkCode: createCreateClinicLinkCodeUseCase(clinicPatientsDeps),
  };

  const portalController: ClinicPatientsPortalController = {
    listClinicPatients: createListClinicPatientsUseCase(clinicPatientsDeps),
    createClinicPatient: createCreateClinicPatientUseCase(clinicPatientsDeps),
    linkClinicPatient: createLinkClinicPatientUseCase(clinicPatientsDeps),
    getClinicPatient: createGetClinicPatientUseCase(clinicPatientsDeps),
    updateClinicPatient: createUpdateClinicPatientUseCase(clinicPatientsDeps),
    getClinicPatientRecord: createGetClinicPatientRecordUseCase(clinicPatientsDeps),
    getClinicSharedHistory: createGetSharedHistoryUseCase(clinicPatientsDeps),
    clinicGlobalSearch: createClinicGlobalSearchUseCase(clinicPatientsDeps),
    getClinicCalendar: createGetClinicCalendarUseCase(clinicPatientsDeps),
  };

  return {
    router: createClinicPatientsFamilyRouter(familyController),
    clinicPortalRouter: createClinicPatientsPortalRouter(portalController),
    directory: {
      resolvePatient: createResolvePatientUseCase(clinicPatientsDeps),
      ensureLinkedByEmail: createEnsureLinkedByEmailUseCase(clinicPatientsDeps),
      bookVisit: createBookVisitUseCase(clinicPatientsDeps),
      listVisits: createListVisitsUseCase(clinicPatientsDeps),
      cancelVisit: createCancelVisitUseCase(clinicPatientsDeps),
      completeVisit: createCompleteVisitUseCase(clinicPatientsDeps),
      countActiveVisitsBySlot: createCountActiveVisitsBySlotUseCase(clinicPatientsDeps),
      findPatientIdsByMembers: createFindPatientIdsByMembersUseCase(clinicPatientsDeps),
    },
  };
}

export interface ClinicPatientsWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  boss: PgBoss;
}

export interface ClinicPatientsWorkerModule {
  /** Job diário `clinic-patients.purge-link-codes` (BR-CLN-20) — só o processo "worker" chama isto. */
  registerWorkers: () => Promise<void>;
  /** A limpeza em si (idempotente), exposta para testes e execução manual. */
  purgeLinkCodes: ReturnType<typeof createPurgeLinkCodesJobUseCase<Kysely<Database>>>;
}

/** Composition root do processo "worker": só BD, auditoria e relógio (nunca `access`/HTTP). */
export function createClinicPatientsWorkerModule(deps: ClinicPatientsWorkerModuleDeps): ClinicPatientsWorkerModule {
  const purgeLinkCodes = createPurgeLinkCodesJobUseCase<Kysely<Database>>({
    codesRepo: new KyselyLinkCodesRepository(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  return {
    purgeLinkCodes,
    registerWorkers: async () => {
      await registerPurgeLinkCodesWorker(deps.boss, purgeLinkCodes);
    },
  };
}
