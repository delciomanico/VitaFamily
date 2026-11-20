// Jobs de `record-sharing` (pg-boss, modules.md §5) — só esta camada importa "pg-boss" (conventions.md §3.9).
import type PgBoss from "pg-boss";
import type { ShareNotices } from "../application/ports.js";

export const NOTIFY_PROFESSIONAL_QUEUE = "record-sharing.notify-professional";

export interface NotifyProfessionalJob {
  professionalId: string;
  shareId: string;
}

/** Enfileira UM aviso por partilha (`singletonKey` = `shareId`, BR-MKT-78); o payload só leva ids (sem conteúdo, rótulo nem categorias). */
export class PgBossShareNotices implements ShareNotices {
  private ready: Promise<void> | undefined;

  constructor(private readonly boss: PgBoss) {}

  async enqueueNewShare(input: NotifyProfessionalJob): Promise<void> {
    // `send` exige a fila criada; `createQueue` é idempotente (o worker, S8, também a cria).
    this.ready ??= this.boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
    await this.ready;
    await this.boss.send(NOTIFY_PROFESSIONAL_QUEUE, input, { singletonKey: input.shareId, retryLimit: 5, retryDelay: 60, retryBackoff: true });
  }
}
