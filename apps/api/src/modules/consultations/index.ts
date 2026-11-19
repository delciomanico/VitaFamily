// Raiz do módulo `consultations` (MK3, ADR-037, ADR-015; modules.md nota 37): única API pública importável (só por `main/`) e composition
// root do módulo. Importa apenas `audit` e `platform`; tudo o resto entra por PORTAS ligadas em `main/api.ts`.
import { Router } from "express";
import type { Kysely } from "kysely";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { AuditModule } from "../audit/index.js";
import { createGetBookingActFacts } from "./application/act-facts.js";
import { createFamilyBookings } from "./application/family-bookings.js";
import type {
  BookingAccess,
  ConsultationsDeps,
  ConversationLookup,
  FamilyAppointmentWriter,
  ProcessLinker,
  ProfessionalAgenda,
  SelfDealingGuard,
} from "./application/ports.js";
import { KyselyBookingRepository } from "./infrastructure/repo.js";
import { createFamilyBookingsRouter } from "./interface/family-router.js";

export * from "./domain/index.js";
export { createSelfDealingGuard } from "./application/self-dealing.js";
export type { BookingAccess, ConversationLookup, FamilyAppointmentWriter, ProcessLinker, ProfessionalAgenda, SelfDealingGuard } from "./application/ports.js";

type Trx = Kysely<Database>;

export interface ConsultationsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  access: BookingAccess<Trx>;
  agenda: ProfessionalAgenda<Trx>;
  selfDealing: SelfDealingGuard;
  processes: ProcessLinker<Trx>;
  appointments: FamilyAppointmentWriter<Trx>;
  conversations: ConversationLookup<Trx>;
}

export interface ConsultationsModule {
  /** `/families/{f}/members/{m}/bookings*` e `/marketplace/professionals/{id}/slots` (User autenticado). */
  familyRouter: Router;
  /** `ProcessFacts` de `originType=BOOKING` (ligado no adaptador composto de `main/api.ts`). */
  getActFacts: ReturnType<typeof createGetBookingActFacts<Trx>>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createConsultationsModule(deps: ConsultationsModuleDeps): ConsultationsModule {
  const bookings = new KyselyBookingRepository();
  const consultationsDeps: ConsultationsDeps<Trx> = {
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    audit: deps.audit,
    access: deps.access,
    agenda: deps.agenda,
    selfDealing: deps.selfDealing,
    processes: deps.processes,
    appointments: deps.appointments,
    conversations: deps.conversations,
    bookings,
  };
  return {
    familyRouter: createFamilyBookingsRouter(createFamilyBookings(consultationsDeps)),
    getActFacts: createGetBookingActFacts({ bookings, clock: deps.clock }),
  };
}
