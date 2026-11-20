// Raiz do módulo `record-sharing` (MK4, ADR-037 §8, ADR-015; modules.md nota 38): única API pública importável (só por `main/`) e composition
// root do módulo. Importa apenas `audit` e `platform`; tudo o resto entra por PORTAS ligadas em `main/api.ts`.
import { Router } from "express";
import type PgBoss from "pg-boss";
import type { Kysely } from "kysely";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { RateLimiter } from "../../platform/rate-limit/async.js";
import type { AuditModule } from "../audit/index.js";
import { createFamilyShares } from "./application/family-shares.js";
import { createExportRecordShares } from "./application/export.js";
import { createNotifyNewShare, createPurgeExpiredShares, type ShareMailer, type ShareProfessionalContact } from "./application/maintenance.js";
import { createProfessionalShares } from "./application/professional-shares.js";
import type { RecordSharingDeps, ShareAccess, ShareAnchor, ShareMembers, ShareNotices, ShareProfessionals } from "./application/ports.js";
import type { SharedRecordsReader } from "./application/shared-records.js";
import { PgBossShareNotices } from "./infrastructure/jobs.js";
import { KyselyShareRetentionRepository } from "./infrastructure/maintenance-repo.js";
import { SmtpShareNoticeMailer } from "./infrastructure/mailer-smtp.js";
import { registerNotifyProfessionalWorker, registerPurgeExpiredWorker } from "./infrastructure/workers.js";
import { KyselyRecordShareRepository } from "./infrastructure/repo.js";
import { createFamilySharesRouter } from "./interface/family-router.js";
import { createProfessionalSharesRouter } from "./interface/professional-router.js";

export * from "./domain/index.js";
export { createSharedRecordsReader, type SharedRecordsReader, type SharedRecordsSources } from "./application/shared-records.js";
export { PgBossShareNotices, SmtpShareNoticeMailer };
export type { ShareAccess, ShareAnchor, ShareMembers, ShareNotices, ShareProfessionals } from "./application/ports.js";

type Trx = Kysely<Database>;

export interface RecordSharingModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  /** Porta assíncrona (ADR-038), namespace `record-sharing`; injetada pela composição. */
  rateLimiter: RateLimiter;
  access: ShareAccess<Trx>;
  anchor: ShareAnchor<Trx>;
  professionals: ShareProfessionals;
  members: ShareMembers<Trx>;
  /** Leituras de saúde no momento da abertura (compostas em `main/api.ts` sobre os módulos dono; sem `AccessPolicy`). */
  reader: SharedRecordsReader<Trx>;
  /** Aviso genérico ao profissional (fila, depois do commit). */
  notices: ShareNotices;
}

export interface RecordSharingModule {
  /** `/families/{f}/members/{m}/record-shares*` (User autenticado). */
  familyRouter: Router;
  /** `/professional-portal/shares*` (token de `ProfessionalAccount`; lista, detalhe e `open`). */
  professionalRouter: Router;
  /** Fonte `recordShares` da exportação do titular (BR-MKT-76): ligada a `lifecycle` em `main/api.ts`, sem `lifecycle` importar `record-sharing`. */
  reads: { recordShares: ReturnType<typeof createExportRecordShares<Trx>> };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createRecordSharingModule(deps: RecordSharingModuleDeps): RecordSharingModule {
  const sharingDeps: RecordSharingDeps<Trx> = {
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    rateLimiter: deps.rateLimiter,
    audit: deps.audit,
    access: deps.access,
    anchor: deps.anchor,
    professionals: deps.professionals,
    members: deps.members,
    reader: deps.reader,
    notices: deps.notices,
    shares: new KyselyRecordShareRepository(),
  };
  return {
    familyRouter: createFamilySharesRouter(createFamilyShares(sharingDeps)),
    professionalRouter: createProfessionalSharesRouter(createProfessionalShares(sharingDeps)),
    reads: { recordShares: createExportRecordShares(sharingDeps) },
  };
}

export interface RecordSharingWorkerDeps {
  db: Kysely<Database>;
  clock: Clock;
  audit: AuditModule;
  boss: PgBoss;
  /** E-mail de notificação da conta do profissional (`professionals`, ligado em `main/worker.ts`). */
  contact: ShareProfessionalContact;
  mailer: ShareMailer;
}

/** Jobs (sem pg-boss; testáveis diretamente): expurgo por retenção e aviso genérico. */
export function createRecordSharingMaintenance(deps: Omit<RecordSharingWorkerDeps, "boss">) {
  return {
    purgeExpired: createPurgeExpiredShares<Trx>({
      withTransaction: (fn) => withTransaction(deps.db, fn),
      clock: deps.clock,
      audit: deps.audit,
      retention: new KyselyShareRetentionRepository(),
    }),
    notifyNewShare: createNotifyNewShare({ contact: deps.contact, mailer: deps.mailer }),
  };
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createRecordSharingWorkerModule(deps: RecordSharingWorkerDeps) {
  const maintenance = createRecordSharingMaintenance(deps);
  return {
    maintenance,
    registerWorkers: async (): Promise<void> => {
      await registerNotifyProfessionalWorker(deps.boss, (job) => maintenance.notifyNewShare(job));
      await registerPurgeExpiredWorker(deps.boss, () => maintenance.purgeExpired());
    },
  };
}
