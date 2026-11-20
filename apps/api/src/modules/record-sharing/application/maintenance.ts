// Jobs de `record-sharing` (UC-MKT-56/57; BR-MKT-76/78): expurgo diário por retenção e aviso genérico ao profissional. Sem pg-boss aqui
// (a fila vive em `infrastructure/jobs.ts`); testáveis diretamente. Nada daqui lê nem escreve conteúdo partilhado.
import { SHARE_LIMITS } from "../domain/index.js";
import type { AuditPort, ShareClock, WithTransaction } from "./ports.js";

/** Apaga partilhas terminadas há mais de `retentionMonths` (as vistas vão em cascata). */
export interface ShareRetentionRepository<Trx> {
  /** Fim real = `GREATEST(expires_at, revoked_at, consumed_at)`; apaga as com fim anterior a `cutoff`. As `ACTIVE` não expiradas nunca (o seu fim é futuro). */
  purgeEndedBefore(trx: Trx, cutoff: Date): Promise<number>;
  /** Instante `now - months` (aritmética de calendário na BD, `Africa/Luanda` não tem DST). */
  monthsBefore(trx: Trx, now: Date, months: number): Promise<Date>;
}

export function createPurgeExpiredShares<Trx>(deps: { withTransaction: WithTransaction<Trx>; clock: ShareClock; audit: AuditPort<Trx>; retention: ShareRetentionRepository<Trx> }) {
  /** Idempotente: repetir não apaga mais nada. Auditoria `SYSTEM` só com a contagem, e só quando algo foi apagado. */
  return async function purgeExpiredShares(): Promise<{ count: number }> {
    const now = deps.clock.now();
    return deps.withTransaction(async (trx) => {
      const cutoff = await deps.retention.monthsBefore(trx, now, SHARE_LIMITS.retentionMonths);
      const count = await deps.retention.purgeEndedBefore(trx, cutoff);
      if (count > 0) {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "SYSTEM",
          action: "RECORD_SHARES_PURGED",
          resourceType: "RecordShare",
          result: "SUCCESS",
          requestId: "job:record-sharing.purge-expired",
          metadata: { count },
        });
      }
      return { count };
    });
  };
}

/** Contacto do profissional (e-mail de notificação da conta; `professionals` em `main/worker.ts`). */
export interface ShareProfessionalContact {
  getNotificationEmail(professionalId: string): Promise<string | null>;
}

/** Texto FIXO («Tem uma nova partilha de registos.»), sem nome, rótulo, categorias nem prazo (BR-MKT-78). */
export interface ShareMailer {
  sendNewShareNotice(to: string): Promise<void>;
}

export type ShareNoticeResult = "SENT" | "SKIPPED";

export function createNotifyNewShare(deps: { contact: ShareProfessionalContact; mailer: ShareMailer }) {
  /** Profissional sem e-mail ⇒ ignora (a lista do portal é a fonte). O erro relança-se SEM causa nem destinatário (retry da fila). */
  return async function notifyNewShare(job: { professionalId: string; shareId: string }): Promise<ShareNoticeResult> {
    const email = await deps.contact.getNotificationEmail(job.professionalId);
    if (!email) return "SKIPPED";
    try {
      await deps.mailer.sendNewShareNotice(email);
    } catch {
      throw new Error("share_notice_failed");
    }
    return "SENT";
  };
}
