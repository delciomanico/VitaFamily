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
import { createNotifyProfessional } from "./application/notify-professional.js";
import { createReconcileBookings, createRequeuePendingProofs } from "./application/reconcile.js";
import { createExportBookings } from "./application/export.js";
import { createPurgeExpiredProofs } from "./application/purge-expired.js";
import { createFamilyBookings } from "./application/family-bookings.js";
import { createFamilyProofs, createProfessionalProofs, createProofJobs } from "./application/proofs.js";
import { createReviews } from "./application/reviews.js";
import { createProfessionalBookings } from "./application/professional-bookings.js";
import type {
  BookingAccess,
  BookingAlerts,
  ProfessionalContact,
  ProfessionalMailer,
  ProfessionalNotices,
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
import { PURGE_EXPIRED_QUEUE, PURGE_EXPIRED_CRON, RECONCILE_BOOKINGS_QUEUE, REQUEUE_PENDING_PROOFS_QUEUE, registerDailyWorker, registerDeleteFilesWorker, registerEvery5MinWorker, registerNotifyProfessionalWorker, registerScanProofWorker } from "./infrastructure/jobs.js";
import { KyselyProofRepository } from "./infrastructure/proof-repo.js";
import { KyselyBookingRepository } from "./infrastructure/repo.js";
import { KyselyReviewRepository } from "./infrastructure/review-repo.js";
import { StorageProofFileStore } from "./infrastructure/storage-file-store.js";
import { createAdminDisputesRouter } from "./interface/admin-router.js";
import { createFamilyBookingsRouter } from "./interface/family-router.js";
import { createReviewsRouters } from "./interface/reviews-router.js";
import { createProfessionalBookingsRouter } from "./interface/professional-router.js";
import { createFamilyProofsRouter, createProfessionalProofsRouter } from "./interface/proofs-router.js";

export * from "./domain/index.js";
export { createSelfDealingGuard } from "./application/self-dealing.js";
export { ProofClamAvScanner } from "./infrastructure/clamav-client.js";
export { PgBossProfessionalNotices, PgBossProofScanQueue } from "./infrastructure/jobs.js";
export { SmtpProfessionalNoticeMailer } from "./infrastructure/mailer-smtp.js";
export type { BookingAlerts, FamilyAlertKind, ProfessionalContact, ProfessionalMailer, ProfessionalNoticeEvent, ProfessionalNotices, ProofScanQueue, ProofScanner } from "./application/ports.js";
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
  /** Alertas `BOOKING_UPDATED`/`PAYMENT_UPDATED` à família, na transação da mudança (BR-MKT-65). */
  alerts: BookingAlerts<Trx>;
  /** Aviso genérico ao profissional (fila, depois do commit). */
  notices: ProfessionalNotices;
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
  /** Porta `ReviewStats` de `discovery` (BR-MKT-61): agregações `{professionalId, count, sum}`, sem textos nem ids de família. */
  reviewStats: ReturnType<typeof createReviews<Trx>>["stats"];
  /** Fonte `bookings` da exportação do titular (BR-MKT-64): ligada a `lifecycle` em `main/api.ts`, sem `lifecycle` importar `consultations`. */
  reads: { bookings: ReturnType<typeof createExportBookings<Trx>> };
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
    alerts: deps.alerts,
    notices: deps.notices,
    bookings,
    proofs: new KyselyProofRepository(),
    reviews: new KyselyReviewRepository(),
    fileStore: new StorageProofFileStore(deps.storage),
    scanQueue: deps.scanQueue,
  };
  const reviews = createReviews(consultationsDeps);
  const reviewRouters = createReviewsRouters(reviews);
  const familyRouter = Router();
  familyRouter.use(createFamilyBookingsRouter(createFamilyBookings(consultationsDeps)));
  familyRouter.use(createFamilyProofsRouter(createFamilyProofs(consultationsDeps)));
  familyRouter.use(reviewRouters.familyRouter);
  const professionalRouter = Router();
  professionalRouter.use(reviewRouters.professionalRouter);
  professionalRouter.use(createProfessionalBookingsRouter(createProfessionalBookings(consultationsDeps)));
  professionalRouter.use(createProfessionalProofsRouter(createProfessionalProofs(consultationsDeps)));
  const adminRouter = Router();
  adminRouter.use(createAdminDisputesRouter(createAdminDisputes(consultationsDeps)));
  adminRouter.use(reviewRouters.adminRouter);
  return {
    familyRouter,
    professionalRouter,
    adminRouter,
    getActFacts: createGetBookingActFacts({ bookings, clock: deps.clock }),
    reviewStats: reviews.stats,
    reads: { bookings: createExportBookings(consultationsDeps) },
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

export interface ConsultationsMaintenanceDeps {
  db: Kysely<Database>;
  clock: Clock;
  audit: AuditModule;
  agenda: Pick<ProfessionalAgenda<Trx>, "findIdentities" | "releaseSlot">;
  appointments: Pick<FamilyAppointmentWriter<Trx>, "syncFromBooking">;
  alerts: BookingAlerts<Trx>;
  scanQueue: ProofScanQueue;
  contact: ProfessionalContact;
  mailer: ProfessionalMailer;
}

/** Jobs de manutenção/avisos (sem pg-boss; testáveis diretamente): reconciliar marcações, reenfileirar antivírus, avisar o profissional. */
export function createConsultationsMaintenance(deps: ConsultationsMaintenanceDeps) {
  const run = <T>(fn: (trx: Trx) => Promise<T>): Promise<T> => withTransaction(deps.db, fn);
  return {
    purgeExpired: createPurgeExpiredProofs<Trx>({ withTransaction: run, clock: deps.clock, audit: deps.audit, proofs: new KyselyProofRepository(), fileDeletions: new KyselyFileDeletionRepository() }),
    reconcileBookings: createReconcileBookings<Trx>({ withTransaction: run, clock: deps.clock, audit: deps.audit, bookings: new KyselyBookingRepository(), agenda: deps.agenda, appointments: deps.appointments, alerts: deps.alerts }),
    requeuePendingProofs: createRequeuePendingProofs<Trx>({ withTransaction: run, clock: deps.clock, proofs: new KyselyProofRepository(), scanQueue: deps.scanQueue }),
    notifyProfessional: createNotifyProfessional({ contact: deps.contact, mailer: deps.mailer }),
  };
}

export interface ConsultationsWorkerModule {
  jobs: ReturnType<typeof createConsultationsJobs>;
  maintenance: ReturnType<typeof createConsultationsMaintenance>;
  registerWorkers: () => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts): antivírus, outbox de ficheiros, reconciliação, reenfileiramento e avisos. */
export function createConsultationsWorkerModule(deps: ConsultationsWorkerModuleDeps & ConsultationsMaintenanceDeps & { boss: PgBoss }): ConsultationsWorkerModule {
  const jobs = createConsultationsJobs(deps);
  const maintenance = createConsultationsMaintenance(deps);
  return {
    jobs,
    maintenance,
    registerWorkers: async () => {
      await registerScanProofWorker(deps.boss, (job) => jobs.scanProof(job));
      await registerDeleteFilesWorker(deps.boss, () => jobs.deleteFiles());
      await registerEvery5MinWorker(deps.boss, RECONCILE_BOOKINGS_QUEUE, () => maintenance.reconcileBookings());
      await registerEvery5MinWorker(deps.boss, REQUEUE_PENDING_PROOFS_QUEUE, () => maintenance.requeuePendingProofs());
      await registerDailyWorker(deps.boss, PURGE_EXPIRED_QUEUE, PURGE_EXPIRED_CRON, () => maintenance.purgeExpired());
      await registerNotifyProfessionalWorker(deps.boss, (job) => maintenance.notifyProfessional(job));
    },
  };
}
