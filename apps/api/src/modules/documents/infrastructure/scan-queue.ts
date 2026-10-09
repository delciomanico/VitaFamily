// Fila `documents.scan` (pg-boss, modules.md §5/§2: "documents (antivírus)" roda no processo
// worker). Implementa `ScanQueuePort` (application/ports.ts) — só esta camada importa "pg-boss"
// (conventions.md §3.9).
import type PgBoss from "pg-boss";
import type { ScanQueuePort } from "../application/ports.js";

export const DOCUMENTS_SCAN_QUEUE = "documents.scan";

export interface ScanJobData {
  documentId: string;
  familyId: string;
}

export class PgBossScanQueue implements ScanQueuePort {
  constructor(private readonly boss: PgBoss) {}

  async enqueueScan(job: ScanJobData): Promise<void> {
    await this.boss.send(DOCUMENTS_SCAN_QUEUE, job);
  }
}

/**
 * Regista o handler do job no worker (main/worker.ts: "cada módulo regista os seus jobs aqui").
 * Idempotente por desenho (`scan-document.ts`: no-op se o documento já não está `PENDING`).
 */
export async function registerScanWorker(
  boss: PgBoss,
  handler: (job: ScanJobData) => Promise<void>,
): Promise<string> {
  return boss.work<ScanJobData>(DOCUMENTS_SCAN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });
}
