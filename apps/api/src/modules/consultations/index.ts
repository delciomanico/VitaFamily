// Raiz do módulo `consultations` (MK3, ADR-037, ADR-015; modules.md nota 37): única API pública importável (só por `main/`) e composition
// root do módulo. Importa apenas `audit` e `platform`; tudo o resto entra por PORTAS ligadas em `main/api.ts`.
import { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { Storage } from "../../platform/storage/index.js";
import type { AuditModule } from "../audit/index.js";
import { createGetBookingActFacts } from "./application/act-facts.js";
import { createAdminDisputes } from "./application/admin-disputes.js";
import { createFamilyBookings } from "./application/family-bookings.js";
import { createFamilyProofs, createProfessionalProofs, createProofJobs } from "./application/proofs.js";
import { createProfessionalBookings } from "./application/professional-bookings.js";
import type {
  BookingAccess,
  ConsultationsDeps,
  ConversationLookup,
  FamilyAppointmentWriter,
  ProcessLinker,
  ProfessionalAgenda,
  ProofScanQueue,
  ProofScanner,
  SelfDealingGuard,
} from "./application/ports.js";
import { KyselyFileDeletionRepository } from "./infrastructure/file-deletion-repo.js";
import { registerDeleteFilesWorker, registerScanProofWorker } from "./infrastructure/jobs.js";
import { KyselyProofRepository } from "./infrastructure/proof-repo.js";
import { KyselyBookingRepository } from "./infrastructure/repo.js";
import { StorageProofFileStore } from "./infrastructure/storage-file-store.js";
import { createAdminDisputesRouter } from "./interface/admin-router.js";
import { createFamilyBookingsRouter } from "./interface/family-router.js";
import { createProfessionalBookingsRouter } from "./interface/professional-router.js";
import { createFamilyProofsRouter, createProfessionalProofsRouter } from "./interface/proofs-router.js";

export * from "./domain/index.js";
export { createSelfDealingGuard } from "./application/self-dealing.js";
export { ProofClamAvScanner } from "./infrastructure/clamav-client.js";
export { PgBossProofScanQueue } from "./infrastructure/jobs.js";
export type { ProofScanQueue, ProofScanner } from "./application/ports.js";
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
  /** Armazenamento de objetos (MinIO; `InMemoryStorage` nos testes): só pela porta `ProofFileStore`. */
  storage: Storage;
  scanQueue: ProofScanQueue;
}

export interface ConsultationsModule {
  /** `/families/{f}/members/{m}/bookings*` e `/marketplace/professionals/{id}/slots` (User autenticado). */
  familyRouter: Router;
  /** `/admin/payment-disputes*` (S9) e, na S10, `/admin/review-reports*` (só `PLATFORM_ADMIN`). */
  adminRouter: Router;
  /** `/professional-portal/bookings*` (token de `ProfessionalAccount`). */
  professionalRouter: Router;
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
    proofs: new KyselyProofRepository(),
    fileStore: new StorageProofFileStore(deps.storage),
    scanQueue: deps.scanQueue,
  };
  const familyRouter = Router();
  familyRouter.use(createFamilyBookingsRouter(createFamilyBookings(consultationsDeps)));
  familyRouter.use(createFamilyProofsRouter(createFamilyProofs(consultationsDeps)));
  const professionalRouter = Router();
  professionalRouter.use(createProfessionalBookingsRouter(createProfessionalBookings(consultationsDeps)));
  professionalRouter.use(createProfessionalProofsRouter(createProfessionalProofs(consultationsDeps)));
  const adminRouter = Router();
  adminRouter.use(createAdminDisputesRouter(createAdminDisputes(consultationsDeps)));
  return {
    familyRouter,
    professionalRouter,
    adminRouter,
    getActFacts: createGetBookingActFacts({ bookings, clock: deps.clock }),
  };
}

export interface ConsultationsWorkerModuleDeps {
  db: Kysely<Database>;
  clock: Clock;
  storage: Storage;
  scanner: ProofScanner;
}

/** Casos de uso dos jobs, sem pg-boss (testáveis diretamente). */
export function createConsultationsJobs(deps: ConsultationsWorkerModuleDeps): ReturnType<typeof createProofJobs<Trx>> {
  return createProofJobs<Trx>({
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    bookings: new KyselyBookingRepository(),
    proofs: new KyselyProofRepository(),
    fileDeletions: new KyselyFileDeletionRepository(),
    fileStore: new StorageProofFileStore(deps.storage),
    scanner: deps.scanner,
  });
}

export interface ConsultationsWorkerModule {
  jobs: ReturnType<typeof createConsultationsJobs>;
  registerWorkers: () => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts): antivírus dos comprovativos e outbox de ficheiros. */
export function createConsultationsWorkerModule(deps: ConsultationsWorkerModuleDeps & { boss: PgBoss }): ConsultationsWorkerModule {
  const jobs = createConsultationsJobs(deps);
  return {
    jobs,
    registerWorkers: async () => {
      await registerScanProofWorker(deps.boss, (job) => jobs.scanProof(job));
      await registerDeleteFilesWorker(deps.boss, () => jobs.deleteFiles());
    },
  };
}
