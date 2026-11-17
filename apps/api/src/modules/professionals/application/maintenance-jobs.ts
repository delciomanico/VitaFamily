// Jobs diários de `professionals` (modules.md nota 35 f; idempotentes; handlers chamados só pela `infrastructure`):
// `expire-credentials` (BR-MKT-21), `generate-slots` (BR-MKT-25: janela rolante de 8 semanas) e `cleanup` (tokens/sessões expirados e
// credenciais que ficaram sem antivírus). Cada profissional é tratado na SUA transação, com `FOR UPDATE` (serializa com decisões do admin e
// com escritas do próprio); uma falha num profissional não pára os restantes. Auditoria: UMA entrada `SYSTEM` por execução, só contagens.
import type { Clock } from "../../../platform/clock/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import { addGeneration, emptyGeneration, type GenerationCounts } from "../domain/schedule.js";
import { failsByExpiry } from "../domain/requirements.js";
import { EXPIRY_REASON, expireTransition } from "../domain/validation-status.js";
import { computeMissing } from "./profile.js";
import type { AuditPort, CredentialScanQueue, MaintenanceRepository, ProfessionalProfileRepository, ScheduleRuleRepository, SlotRepository, TimeOffRepository, ValidationCaseRepository, WithTransaction } from "./ports.js";
import { reconcileSchedule } from "./schedule-sync.js";

export interface MaintenanceJobsDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  logger: Logger;
  audit: AuditPort<Trx>;
  profileRepo: ProfessionalProfileRepository<Trx>;
  validationCaseRepo: ValidationCaseRepository<Trx>;
  scheduleRuleRepo: ScheduleRuleRepository<Trx>;
  timeOffRepo: TimeOffRepository<Trx>;
  slotRepo: SlotRepository<Trx>;
  maintenanceRepo: MaintenanceRepository<Trx>;
  scanQueue: CredentialScanQueue;
}

const jobRequestId = (name: string, now: Date): string => `job:professionals.${name}:${now.toISOString()}`;

/** BR-MKT-21: `APPROVED` cujo BR-MKT-16 deixou de estar satisfeito POR CADUCIDADE ⇒ `NEEDS_INFO` + `ValidationCase EXPIRED` (SYSTEM). */
export function createExpireCredentialsUseCase<Trx>(deps: MaintenanceJobsDeps<Trx>) {
  return async function expireCredentials(): Promise<{ expired: number }> {
    const now = deps.clock.now();
    const ids = await deps.withTransaction((trx) => deps.profileRepo.listIdsByStatus(trx, "APPROVED"));
    let expired = 0;
    for (const id of ids) {
      try {
        const done = await deps.withTransaction(async (trx) => {
          const record = await deps.profileRepo.findByIdForUpdate(trx, id);
          if (record?.validationStatus !== "APPROVED") return false; // mudou entretanto (ex. suspensão): nada a fazer
          if (!failsByExpiry(await computeMissing(deps, trx, record))) return false;
          const transition = expireTransition(record.validationStatus);
          await deps.profileRepo.updateStatus(trx, id, { validationStatus: transition.to, statusReason: EXPIRY_REASON, statusChangedAt: now }, now);
          await deps.validationCaseRepo.insert(trx, { id: newId(), professionalId: id, action: transition.action, fromStatus: transition.from, toStatus: transition.to, actor: transition.actor, reason: EXPIRY_REASON, createdAt: now });
          return true;
        });
        if (done) expired += 1;
      } catch (err) {
        deps.logger.error({ err, professionalId: id }, "professionals_expire_credentials_failed");
      }
    }
    await deps.withTransaction((trx) =>
      deps.audit.record(trx, { occurredAt: now, actorType: "SYSTEM", action: "PROFESSIONAL_CREDENTIAL_EXPIRED", resourceType: "Professional", result: "SUCCESS", requestId: jobRequestId("expire-credentials", now), metadata: { count: expired } }),
    );
    return { expired };
  };
}

/** BR-MKT-25: mantém a janela rolante de 8 semanas de todos os `APPROVED` com regras ativas (idempotente: repetir não duplica). */
export function createGenerateSlotsUseCase<Trx>(deps: MaintenanceJobsDeps<Trx>) {
  return async function generateSlots(): Promise<GenerationCounts & { professionals: number }> {
    const now = deps.clock.now();
    const ids = await deps.withTransaction((trx) => deps.scheduleRuleRepo.listApprovedProfessionalIdsWithActiveRules(trx));
    let total = emptyGeneration();
    let professionals = 0;
    for (const id of ids) {
      try {
        const counts = await deps.withTransaction(async (trx) => {
          const record = await deps.profileRepo.findByIdForUpdate(trx, id);
          if (record?.validationStatus !== "APPROVED") return emptyGeneration();
          return reconcileSchedule(deps, trx, id, true, now);
        });
        total = addGeneration(total, counts);
        professionals += 1;
      } catch (err) {
        deps.logger.error({ err, professionalId: id }, "professionals_generate_slots_failed");
      }
    }
    await deps.withTransaction((trx) =>
      deps.audit.record(trx, {
        occurredAt: now,
        actorType: "SYSTEM",
        action: "PROFESSIONAL_SCHEDULE_GENERATE",
        resourceType: "Professional",
        result: "SUCCESS",
        requestId: jobRequestId("generate-slots", now),
        metadata: { professionals, created: total.created, removed: total.removed, skippedOverlap: total.skippedOverlap, skippedTimeOff: total.skippedTimeOff },
      }),
    );
    return { ...total, professionals };
  };
}

const RETENTION_DAYS = 7;
/** Uma credencial `PENDING` há mais de 10 min perdeu o job de antivírus (fila indisponível/worker em baixo): volta a enfileirar-se. */
const STALE_PENDING_MS = 10 * 60 * 1000;

export function createCleanupUseCase<Trx>(deps: MaintenanceJobsDeps<Trx>) {
  return async function cleanup(): Promise<{ tokens: number; sessions: number; rescans: number }> {
    const now = deps.clock.now();
    const before = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000);
    const { tokens, sessions, stale } = await deps.withTransaction(async (trx) => ({
      tokens: await deps.maintenanceRepo.deleteExpiredAuthTokens(trx, before),
      sessions: await deps.maintenanceRepo.deleteExpiredSessions(trx, before),
      stale: await deps.maintenanceRepo.listStalePendingCredentialIds(trx, new Date(now.getTime() - STALE_PENDING_MS)),
    }));
    for (const credentialId of stale) await deps.scanQueue.enqueueScan({ credentialId });
    return { tokens, sessions, rescans: stale.length };
  };
}
