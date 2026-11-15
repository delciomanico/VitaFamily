// Job agendado de `insurer-ops` (pg-boss, modules.md §5) — só esta camada importa "pg-boss" (conventions.md §3.9).
// Mesmo padrão de `clinic-patients/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const EXPIRE_POLICIES_QUEUE = "insurer.expire-policies";

/** Diário, logo após a meia-noite UTC (data de calendário `validTo < hoje`); idempotente. */
const DAILY_EXPIRE_CRON = "20 0 * * *";

export async function registerExpirePoliciesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(EXPIRE_POLICIES_QUEUE);
  await boss.schedule(EXPIRE_POLICIES_QUEUE, DAILY_EXPIRE_CRON, {});
  return boss.work(EXPIRE_POLICIES_QUEUE, async () => {
    await handler();
  });
}

export const PURGE_IMPORT_PREVIEWS_QUEUE = "insurer.purge-import-previews";

/** Diário às 00:40 UTC; idempotente (só atua em lotes PREVIEW com mais de 24 h). */
const DAILY_PURGE_CRON = "40 0 * * *";

export async function registerPurgeImportPreviewsWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(PURGE_IMPORT_PREVIEWS_QUEUE);
  await boss.schedule(PURGE_IMPORT_PREVIEWS_QUEUE, DAILY_PURGE_CRON, {});
  return boss.work(PURGE_IMPORT_PREVIEWS_QUEUE, async () => {
    await handler();
  });
}

export const EXPIRE_INFO_REQUESTS_QUEUE = "insurer.expire-info-requests";

/** Diário às 00:50 UTC (BR-AUT-14); idempotente (o estado do pedido muda, logo não o apanha duas vezes). */
const DAILY_EXPIRE_INFO_CRON = "50 0 * * *";

export async function registerExpireInfoRequestsWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(EXPIRE_INFO_REQUESTS_QUEUE);
  await boss.schedule(EXPIRE_INFO_REQUESTS_QUEUE, DAILY_EXPIRE_INFO_CRON, {});
  return boss.work(EXPIRE_INFO_REQUESTS_QUEUE, async () => {
    await handler();
  });
}

export const FLAG_SLA_BREACHES_QUEUE = "insurer.flag-sla-breaches";

/** A cada 15 minutos (BR-AUT-20); idempotente (só marca `IN_REVIEW` com prazo atingido e ainda sem marca). */
const SLA_CRON = "*/15 * * * *";

export async function registerFlagSlaBreachesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(FLAG_SLA_BREACHES_QUEUE);
  await boss.schedule(FLAG_SLA_BREACHES_QUEUE, SLA_CRON, {});
  return boss.work(FLAG_SLA_BREACHES_QUEUE, async () => {
    await handler();
  });
}
