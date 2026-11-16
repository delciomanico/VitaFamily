// Jobs de `professionals` (pg-boss, modules.md §5) — só esta camada importa "pg-boss" (conventions.md §3.9).
import type PgBoss from "pg-boss";
import type { CredentialScanQueue } from "../application/ports.js";

export const SCAN_CREDENTIAL_QUEUE = "professionals.scan-credential";
export const DELETE_FILES_QUEUE = "professionals.delete-files";
/** A cada 5 minutos (modules.md nota 35 f). */
const DELETE_FILES_CRON = "*/5 * * * *";

export interface ScanCredentialJob {
  credentialId: string;
}

export class PgBossCredentialScanQueue implements CredentialScanQueue {
  private ready: Promise<void> | undefined;

  constructor(private readonly boss: PgBoss) {}

  async enqueueScan(job: ScanCredentialJob): Promise<void> {
    // `send` exige a fila criada; `createQueue` é idempotente. Garante-se uma vez por processo (o worker também a cria).
    this.ready ??= this.boss.createQueue(SCAN_CREDENTIAL_QUEUE);
    await this.ready;
    await this.boss.send(SCAN_CREDENTIAL_QUEUE, job);
  }
}

export async function registerScanCredentialWorker(boss: PgBoss, handler: (job: ScanCredentialJob) => Promise<void>): Promise<string> {
  await boss.createQueue(SCAN_CREDENTIAL_QUEUE);
  return boss.work<ScanCredentialJob>(SCAN_CREDENTIAL_QUEUE, async (jobs) => {
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
