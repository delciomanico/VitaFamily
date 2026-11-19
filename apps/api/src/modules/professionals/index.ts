// Raiz do módulo `professionals` (MK1, ADR-037, ADR-015): única API pública importável por outros módulos e composition root do módulo.
// Identidade PRÓPRIA (BR-MKT-13): não importa `auth`, `access`, `families`, `users` nem módulos de saúde (BR-MKT-27); só `audit`.
import { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { Logger } from "../../platform/logger/index.js";
import type { Storage } from "../../platform/storage/index.js";
import { MAX_FILE_BYTES } from "./domain/credential.js";
import type { AuditModule } from "../audit/index.js";
import { createForgotPasswordUseCase } from "./application/forgot-password.js";
import { createLoginUseCase } from "./application/login.js";
import { createLogoutUseCase } from "./application/logout.js";
import type { CredentialScanQueue, CredentialScanner, ProfessionalMailer, ProfessionalsDeps } from "./application/ports.js";
import { createRefreshUseCase } from "./application/refresh.js";
import { createRegisterUseCase } from "./application/register.js";
import { createResendVerificationUseCase } from "./application/resend-verification.js";
import { createResetPasswordUseCase } from "./application/reset-password.js";
import { createResolveActorStateUseCase } from "./application/resolve-actor-state.js";
import {
  createAdminCreateSpecialtyUseCase,
  createAdminListSpecialtiesUseCase,
  createAdminUpdateSpecialtyUseCase,
  createListPortalSpecialtiesUseCase,
} from "./application/specialties.js";
import { createVerifyEmailUseCase } from "./application/verify-email.js";
import type { ProfessionalSigningKey } from "./domain/jwt.js";
import { ProfessionalInMemoryRateLimiter } from "./domain/rate-limiter.js";
import { ProfessionalTtlCache } from "./domain/ttl-cache.js";
import { KyselyProfessionalAccountRepository, KyselyProfessionalAuthTokenRepository, KyselyProfessionalSessionRepository } from "./infrastructure/account-repo.js";
import { createGetMeUseCase, createSetSpecialtiesUseCase, createSubmitUseCase, createUpdateMeUseCase } from "./application/profile.js";
import { KyselyProfessionalProfileRepository, KyselyValidationCaseRepository } from "./infrastructure/profile-repo.js";
import { createDeleteCredentialUseCase, createDownloadCredentialUseCase, createListCredentialsUseCase, createUploadCredentialUseCase } from "./application/credentials.js";
import { createDeleteFilesUseCase, createScanCredentialUseCase } from "./application/credential-jobs.js";
import { KyselyCredentialRepository, KyselyFileDeletionRepository } from "./infrastructure/credential-repo.js";
import { registerDeleteFilesWorker, registerScanCredentialWorker } from "./infrastructure/jobs.js";
import { StorageCredentialFileStore } from "./infrastructure/storage-file-store.js";
import { createAdminDecideProfessionalUseCase, createAdminDownloadCredentialUseCase, createAdminGetProfessionalUseCase, createAdminListProfessionalsUseCase } from "./application/admin-professionals.js";
import { KyselyAdminProfessionalRepository } from "./infrastructure/admin-repo.js";
import { createAdminProfessionalsRouter } from "./interface/admin-professionals-router.js";
import { createCreateOfferUseCase, createListOffersUseCase, createUpdateOfferUseCase } from "./application/offers.js";
import { KyselyOfferRepository } from "./infrastructure/offer-repo.js";
import { createOffersRouter } from "./interface/offers-router.js";
import {
  createCreateScheduleRuleUseCase,
  createCreateTimeOffUseCase,
  createDeleteTimeOffUseCase,
  createListScheduleRulesUseCase,
  createListSlotsUseCase,
  createListTimeOffUseCase,
  createUpdateScheduleRuleUseCase,
} from "./application/schedule.js";
import { reconcileSchedule } from "./application/schedule-sync.js";
import { KyselyScheduleRuleRepository, KyselySlotRepository, KyselyTimeOffRepository } from "./infrastructure/schedule-repo.js";
import { createScheduleRouter } from "./interface/schedule-router.js";
import { createProfessionalDirectory, type ProfessionalDirectoryOf } from "./application/directory.js";
import { createCleanupUseCase, createExpireCredentialsUseCase, createGenerateSlotsUseCase } from "./application/maintenance-jobs.js";
import { KyselyDirectoryRepository, KyselyMaintenanceRepository } from "./infrastructure/directory-repo.js";
import { CLEANUP_QUEUE, EXPIRE_CREDENTIALS_QUEUE, GENERATE_SLOTS_QUEUE, registerDailyWorker } from "./infrastructure/jobs.js";
import { createCredentialsRouter } from "./interface/credentials-router.js";
import { createProfileRouter } from "./interface/profile-router.js";
import { KyselySpecialtyRepository } from "./infrastructure/specialty-repo.js";
import { createProfessionalActorContextMiddleware, createProfessionalBearerAuthSecurityHandler } from "./interface/middleware.js";
import { createProfessionalAuthRouter } from "./interface/router.js";
import { createSpecialtiesRouter } from "./interface/specialties-router.js";

export { parseProfessionalSigningKeys, type ProfessionalSigningKey } from "./domain/jwt.js";
export { ProfessionalSmtpMailer } from "./infrastructure/mailer-smtp.js";
export { ProfessionalFakeMailer } from "./infrastructure/mailer-fake.js";
export type { ProfessionalMailer, CredentialScanner, CredentialScanQueue, BookingFactsRow } from "./application/ports.js";
export type { PublicProfessionalProfile, BookableSlot, DirectoryQuery, ProfessionalFacts, FactsQuery } from "./application/directory.js";
export { CredentialClamAvScanner } from "./infrastructure/clamav-client.js";
export { PgBossCredentialScanQueue } from "./infrastructure/jobs.js";

/** Leitor público com a transação do composition root (`Kysely`); as portas de `consultations` recebem-na (como `ProcessLinker.open`). */
export type ProfessionalDirectory = ProfessionalDirectoryOf<Kysely<Database>>;

/** Estado da conta do portal por pedido, cache ≤60 s (BR-MKT-29). */
const ACCOUNT_STATE_CACHE_TTL_MS = 60_000;

export interface ProfessionalsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  logger: Logger;
  mailer: ProfessionalMailer;
  signingKeys: ProfessionalSigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  cookieDomain: string;
  appBaseUrl: string;
  /** Armazenamento de objetos (MinIO; `InMemoryStorage` nos testes) — usado só pela porta `CredentialFileStore`. */
  storage: Storage;
  /** Fila do antivírus das credenciais (pg-boss em produção). */
  scanQueue: CredentialScanQueue;
  /** `UPLOAD_MAX_BYTES` (omissão 10 MB; BR-MKT-17). */
  maxFileSizeBytes?: number;
}

export interface ProfessionalsModule {
  /** `/professional-portal/auth/*` e `/professional-portal/specialties`, `/admin/specialties*` (MK1 S4). */
  router: Router;
  /** Handler de segurança `professionalBearerAuth` (`createApp({ securityHandlers })`). */
  securityHandlers: { professionalBearerAuth: ReturnType<typeof createProfessionalBearerAuthSecurityHandler> };
  /**
   * Leitor público de profissionais (BR-MKT-19, OP-65): a única forma de MK2/MK3 lerem profissionais. Só `APPROVED`, só dados públicos.
   * Em MK1 não há rota para famílias.
   */
  directory: ProfessionalDirectory;
  /** Middleware a compor com os de `auth` e `clinics` (preenche o TERCEIRO ator, `platform/actor`). */
  actorContextMiddleware: ReturnType<typeof createProfessionalActorContextMiddleware>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createProfessionalsModule(deps: ProfessionalsModuleDeps): ProfessionalsModule {
  const stateCache = new ProfessionalTtlCache<{ professionalId: string }>(deps.clock, ACCOUNT_STATE_CACHE_TTL_MS);
  const rateLimiter = new ProfessionalInMemoryRateLimiter(deps.clock);
  // Sem isto o mapa de janelas cresceria com cada chave distinta (e-mail/IP); `unref` para não segurar o processo.
  setInterval(() => {
    rateLimiter.prune(2 * 60 * 60 * 1000);
  }, 10 * 60 * 1000).unref();
  const profileRepo = new KyselyProfessionalProfileRepository();
  const scheduleRuleRepo = new KyselyScheduleRuleRepository();
  const timeOffRepo = new KyselyTimeOffRepository();
  const slotRepo = new KyselySlotRepository();
  const syncRepos = { scheduleRuleRepo, timeOffRepo, slotRepo };
  const useCaseDeps: ProfessionalsDeps<Kysely<Database>> = {
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    logger: deps.logger,
    audit: deps.audit,
    mailer: deps.mailer,
    accountRepo: new KyselyProfessionalAccountRepository(),
    authTokenRepo: new KyselyProfessionalAuthTokenRepository(),
    sessionRepo: new KyselyProfessionalSessionRepository(),
    specialtyRepo: new KyselySpecialtyRepository(),
    profileRepo,
    validationCaseRepo: new KyselyValidationCaseRepository(),
    credentialRepo: new KyselyCredentialRepository(),
    adminRepo: new KyselyAdminProfessionalRepository(),
    offerRepo: new KyselyOfferRepository(),
    scheduleRuleRepo,
    timeOffRepo,
    slotRepo,
    directoryRepo: new KyselyDirectoryRepository(),
    // Ativar/desativar uma oferta reconcilia os horários das suas regras (BR-MKT-25); só `APPROVED` gera.
    offerSlotSync: {
      onActiveChanged: async (trx, professionalId, offerId, _active, now) => {
        const professional = await profileRepo.findById(trx, professionalId);
        await reconcileSchedule(syncRepos, trx, professionalId, professional?.validationStatus === "APPROVED", now, { offerId });
      },
    },
    // Aprovação/reativação (BR-MKT-25): gera os horários das regras existentes na mesma transação.
    slotGenerator: {
      generateForProfessional: async (trx, professionalId, now) => {
        await reconcileSchedule(syncRepos, trx, professionalId, true, now);
      },
    },
    fileDeletionRepo: new KyselyFileDeletionRepository(),
    fileStore: new StorageCredentialFileStore(deps.storage),
    scanQueue: deps.scanQueue,
    maxFileSizeBytes: deps.maxFileSizeBytes ?? MAX_FILE_BYTES,
    rateLimiter,
    signingKeys: deps.signingKeys,
    accessTtlSeconds: deps.accessTtlSeconds,
    refreshTtlMs: deps.refreshTtlMs,
    appBaseUrl: deps.appBaseUrl,
  };
  const resolveActorState = createResolveActorStateUseCase(useCaseDeps, stateCache);

  const router = Router();
  router.use(
    createProfessionalAuthRouter(
      {
        register: createRegisterUseCase(useCaseDeps),
        verifyEmail: createVerifyEmailUseCase(useCaseDeps),
        resendVerification: createResendVerificationUseCase(useCaseDeps),
        login: createLoginUseCase(useCaseDeps),
        refresh: createRefreshUseCase(useCaseDeps),
        logout: createLogoutUseCase(useCaseDeps),
        forgotPassword: createForgotPasswordUseCase(useCaseDeps),
        resetPassword: createResetPasswordUseCase(useCaseDeps),
      },
      deps.cookieDomain,
    ),
  );
  router.use(
    createSpecialtiesRouter({
      listPortalSpecialties: createListPortalSpecialtiesUseCase(useCaseDeps),
      adminListSpecialties: createAdminListSpecialtiesUseCase(useCaseDeps),
      adminCreateSpecialty: createAdminCreateSpecialtyUseCase(useCaseDeps),
      adminUpdateSpecialty: createAdminUpdateSpecialtyUseCase(useCaseDeps),
    }),
  );

  router.use(
    createAdminProfessionalsRouter({
      list: createAdminListProfessionalsUseCase(useCaseDeps),
      get: createAdminGetProfessionalUseCase(useCaseDeps),
      decide: createAdminDecideProfessionalUseCase(useCaseDeps),
      downloadCredential: createAdminDownloadCredentialUseCase(useCaseDeps),
    }),
  );
  router.use(
    createOffersRouter({
      listOffers: createListOffersUseCase(useCaseDeps),
      createOffer: createCreateOfferUseCase(useCaseDeps),
      updateOffer: createUpdateOfferUseCase(useCaseDeps),
    }),
  );
  router.use(
    createScheduleRouter({
      listScheduleRules: createListScheduleRulesUseCase(useCaseDeps),
      createScheduleRule: createCreateScheduleRuleUseCase(useCaseDeps),
      updateScheduleRule: createUpdateScheduleRuleUseCase(useCaseDeps),
      listTimeOff: createListTimeOffUseCase(useCaseDeps),
      createTimeOff: createCreateTimeOffUseCase(useCaseDeps),
      deleteTimeOff: createDeleteTimeOffUseCase(useCaseDeps),
      listSlots: createListSlotsUseCase(useCaseDeps),
    }),
  );
  router.use(
    createCredentialsRouter({
      listCredentials: createListCredentialsUseCase(useCaseDeps),
      uploadCredential: createUploadCredentialUseCase(useCaseDeps),
      deleteCredential: createDeleteCredentialUseCase(useCaseDeps),
      downloadCredential: createDownloadCredentialUseCase(useCaseDeps),
    }),
  );
  router.use(
    createProfileRouter({
      getMe: createGetMeUseCase(useCaseDeps),
      updateMe: createUpdateMeUseCase(useCaseDeps),
      setSpecialties: createSetSpecialtiesUseCase(useCaseDeps),
      submit: createSubmitUseCase(useCaseDeps),
    }),
  );

  return {
    router,
    directory: createProfessionalDirectory(useCaseDeps),
    securityHandlers: { professionalBearerAuth: createProfessionalBearerAuthSecurityHandler({ signingKeys: deps.signingKeys, clock: deps.clock }) },
    actorContextMiddleware: createProfessionalActorContextMiddleware({ resolveActorState }),
  };
}

export interface ProfessionalsWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  logger: Logger;
  storage: Storage;
  scanner: CredentialScanner;
  /** Para voltar a enfileirar credenciais `PENDING` sem antivírus (job `cleanup`). */
  scanQueue: CredentialScanQueue;
}

export interface ProfessionalsJobs {
  /** `professionals.scan-credential` (antivírus). */
  scanCredential: (job: { credentialId: string }) => Promise<void>;
  /** `professionals.delete-files` (outbox própria). */
  deleteFiles: () => Promise<{ deleted: number; failed: number }>;
  /** `professionals.expire-credentials` (diário, BR-MKT-21). */
  expireCredentials: () => Promise<{ expired: number }>;
  /** `professionals.generate-slots` (diário, BR-MKT-25). */
  generateSlots: ReturnType<typeof createGenerateSlotsUseCase<Kysely<Database>>>;
  /** `professionals.cleanup` (diário). */
  cleanup: () => Promise<{ tokens: number; sessions: number; rescans: number }>;
}

/** Casos de uso dos jobs, sem pg-boss (testáveis diretamente). */
export function createProfessionalsJobs(deps: ProfessionalsWorkerModuleDeps): ProfessionalsJobs {
  const jobDeps = {
    withTransaction: <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(deps.db, fn),
    clock: deps.clock,
    credentialRepo: new KyselyCredentialRepository(),
    fileDeletionRepo: new KyselyFileDeletionRepository(),
    fileStore: new StorageCredentialFileStore(deps.storage),
    scanner: deps.scanner,
  };
  const maintenanceDeps = {
    withTransaction: jobDeps.withTransaction,
    clock: deps.clock,
    logger: deps.logger,
    audit: deps.audit,
    profileRepo: new KyselyProfessionalProfileRepository(),
    validationCaseRepo: new KyselyValidationCaseRepository(),
    scheduleRuleRepo: new KyselyScheduleRuleRepository(),
    timeOffRepo: new KyselyTimeOffRepository(),
    slotRepo: new KyselySlotRepository(),
    maintenanceRepo: new KyselyMaintenanceRepository(),
    scanQueue: deps.scanQueue,
  };
  return {
    scanCredential: createScanCredentialUseCase(jobDeps),
    deleteFiles: createDeleteFilesUseCase(jobDeps),
    expireCredentials: createExpireCredentialsUseCase(maintenanceDeps),
    generateSlots: createGenerateSlotsUseCase(maintenanceDeps),
    cleanup: createCleanupUseCase(maintenanceDeps),
  };
}

export interface ProfessionalsWorkerModule {
  jobs: ProfessionalsJobs;
  /** MK2 (BR-MKT-41): e-mail da conta SÓ para o aviso genérico de nova mensagem do job `messaging.notify-professional` (ligado em `main/worker.ts`). */
  notificationEmail: (professionalId: string) => Promise<string | null>;
  /** MK3 (BR-MKT-54): identidade/estado e libertação do horário SÓ para o job `consultations.reconcile-bookings` (ligado em `main/worker.ts`). */
  agenda: {
    findIdentities: (ids: readonly string[]) => Promise<{ id: string; displayName: string; city: string | null; approved: boolean }[]>;
    releaseSlot: (trx: Kysely<Database>, bookingId: string) => Promise<boolean>;
  };
  registerWorkers: () => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createProfessionalsWorkerModule(deps: ProfessionalsWorkerModuleDeps & { boss: PgBoss }): ProfessionalsWorkerModule {
  const jobs = createProfessionalsJobs(deps);
  const directoryRepo = new KyselyDirectoryRepository();
  return {
    jobs,
    notificationEmail: (professionalId) => withTransaction(deps.db, (trx) => directoryRepo.findNotificationEmail(trx, professionalId)),
    agenda: {
      findIdentities: (ids) => withTransaction(deps.db, (trx) => directoryRepo.findConversationIdentities(trx, [...new Set(ids)])),
      releaseSlot: (trx, bookingId) => directoryRepo.releaseSlot(trx, bookingId),
    },
    registerWorkers: async () => {
      await registerScanCredentialWorker(deps.boss, jobs.scanCredential);
      await registerDeleteFilesWorker(deps.boss, jobs.deleteFiles);
      await registerDailyWorker(deps.boss, EXPIRE_CREDENTIALS_QUEUE, "30 2 * * *", jobs.expireCredentials);
      await registerDailyWorker(deps.boss, GENERATE_SLOTS_QUEUE, "40 2 * * *", jobs.generateSlots);
      await registerDailyWorker(deps.boss, CLEANUP_QUEUE, "10 3 * * *", jobs.cleanup);
    },
  };
}
