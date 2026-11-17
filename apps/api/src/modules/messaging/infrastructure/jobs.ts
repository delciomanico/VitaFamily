// Fila pg-boss do aviso ao profissional (`messaging.notify-professional`): só leva o id da conversa. O envio é «depois do commit» e o
// job volta a tentar com recuo exponencial; a regra «1 e-mail por 30 min» vive na BD (`claimProfessionalNotice`), não na fila.
import type PgBoss from "pg-boss";
import type { ProfessionalNoticeQueue } from "../application/ports.js";

export const NOTIFY_PROFESSIONAL_QUEUE = "messaging.notify-professional";

interface NoticeJob {
  conversationId: string;
}

export class PgBossProfessionalNoticeQueue implements ProfessionalNoticeQueue {
  private ready: Promise<void> | undefined;

  constructor(private readonly boss: PgBoss) {}

  async enqueue(conversationId: string): Promise<void> {
    this.ready ??= this.boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
    await this.ready;
    await this.boss.send(NOTIFY_PROFESSIONAL_QUEUE, { conversationId } satisfies NoticeJob, { retryLimit: 5, retryDelay: 60, retryBackoff: true, singletonKey: conversationId, singletonSeconds: 30 });
  }
}

export async function registerNotifyProfessionalWorker(boss: PgBoss, handler: (conversationId: string) => Promise<unknown>): Promise<string> {
  await boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
  return boss.work<NoticeJob>(NOTIFY_PROFESSIONAL_QUEUE, async (jobs) => {
    for (const job of jobs) await handler(job.data.conversationId);
  });
}
