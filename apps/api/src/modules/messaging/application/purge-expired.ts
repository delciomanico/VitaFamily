// Job diário `messaging.purge-expired` (BR-MKT-45, OP-79): apaga as conversas cuja última mensagem tem MAIS de 24 meses (mensagens e
// denúncias saem por `ON DELETE CASCADE`). Idempotente; auditoria `SYSTEM` só com a contagem (nunca ids nem conteúdo, BR-MKT-46).
import type { AuditPort, ConversationRepository, MessagingClock, WithTransaction } from "./ports.js";

export const RETENTION_MONTHS = 24;

/** Limite de retenção: `now` menos 24 meses de calendário (UTC). Uma conversa com `lastMessageAt` EXATAMENTE neste instante mantém-se. */
export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  return cutoff;
}

export interface PurgeExpiredDeps<Trx> {
  conversations: Pick<ConversationRepository<Trx>, "purgeLastMessageBefore">;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: MessagingClock;
}

export function createPurgeExpired<Trx>(deps: PurgeExpiredDeps<Trx>) {
  return async function purgeExpired(): Promise<{ count: number }> {
    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const count = await deps.conversations.purgeLastMessageBefore(trx, retentionCutoff(now));
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "SYSTEM",
        action: "MESSAGES_PURGED",
        resourceType: "Conversation",
        result: "SUCCESS",
        requestId: "job:messaging.purge-expired",
        metadata: { count },
      });
      return { count };
    });
  };
}

export type PurgeExpired = ReturnType<typeof createPurgeExpired<unknown>>;
