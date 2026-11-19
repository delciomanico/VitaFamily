// Jobs de `consultations` (pg-boss, modules.md §5) — só esta camada importa "pg-boss" (conventions.md §3.9).
import type PgBoss from "pg-boss";
import type { ProfessionalNoticeEvent, ProfessionalNotices, ProofScanQueue } from "../application/ports.js";

export const SCAN_PROOF_QUEUE = "consultations.scan-proof";
export const DELETE_FILES_QUEUE = "consultations.delete-files";
/** A cada 5 minutos (modules.md nota 35 f). */
const DELETE_FILES_CRON = "*/5 * * * *";

export interface ScanProofJob {
  proofId: string;
}

export class PgBossProofScanQueue implements ProofScanQueue {
  private ready: Promise<void> | undefined;

  constructor(private readonly boss: PgBoss) {}

  async enqueueScan(job: ScanProofJob): Promise<void> {
    // `send` exige a fila criada; `createQueue` é idempotente. Garante-se uma vez por processo (o worker também a cria).
    this.ready ??= this.boss.createQueue(SCAN_PROOF_QUEUE);
    await this.ready;
    await this.boss.send(SCAN_PROOF_QUEUE, job);
  }
}

export async function registerScanProofWorker(boss: PgBoss, handler: (job: ScanProofJob) => Promise<void>): Promise<string> {
  await boss.createQueue(SCAN_PROOF_QUEUE);
  return boss.work<ScanProofJob>(SCAN_PROOF_QUEUE, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
}

export async function registerDeleteFilesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(DELETE_FILES_QUEUE);
  await boss.schedule(DELETE_FILES_QUEUE, DELETE_FILES_CRON, {});
  return boss.work(DELETE_FILES_QUEUE, async () => {
    await handler();
  });
}

/** Jobs diários (UTC) de `consultations`: registo genérico, usado em fatias futuras. Todos idempotentes. */
export async function registerDailyWorker(boss: PgBoss, queue: string, cron: string, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a fila criada (FK pgboss.schedule → pgboss.queue).
  await boss.createQueue(queue);
  await boss.schedule(queue, cron, {});
  return boss.work(queue, async () => {
    await handler();
  });
}

export const NOTIFY_PROFESSIONAL_QUEUE = "consultations.notify-professional";
export const RECONCILE_BOOKINGS_QUEUE = "consultations.reconcile-bookings";
export const REQUEUE_PENDING_PROOFS_QUEUE = "consultations.requeue-pending-proofs";
/** A cada 5 minutos (BR-MKT-54; OP-114 iii). */
export const EVERY_5_MIN_CRON = "*/5 * * * *";

interface NoticeJob {
  professionalId: string;
  bookingId: string;
  event: ProfessionalNoticeEvent;
}

/** Fila do aviso ao profissional: `singletonKey` = marcação+evento (idempotente); retry com recuo. Só leva ids e o tipo do evento. */
export class PgBossProfessionalNotices implements ProfessionalNotices {
  private ready: Promise<void> | undefined;

  constructor(private readonly boss: PgBoss) {}

  async enqueue(input: NoticeJob): Promise<void> {
    this.ready ??= this.boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
    await this.ready;
    await this.boss.send(NOTIFY_PROFESSIONAL_QUEUE, input satisfies NoticeJob, { retryLimit: 5, retryDelay: 60, retryBackoff: true, singletonKey: `${input.bookingId}:${input.event}` });
  }
}

export async function registerNotifyProfessionalWorker(boss: PgBoss, handler: (job: { professionalId: string }) => Promise<unknown>): Promise<string> {
  await boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
  return boss.work<NoticeJob>(NOTIFY_PROFESSIONAL_QUEUE, async (jobs) => {
    for (const job of jobs) await handler({ professionalId: job.data.professionalId });
  });
}

/** Job agendado a cada 5 min (`schedule` exige a fila criada). */
export async function registerEvery5MinWorker(boss: PgBoss, queue: string, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(queue);
  await boss.schedule(queue, EVERY_5_MIN_CRON, {});
  return boss.work(queue, async () => {
    await handler();
  });
}
