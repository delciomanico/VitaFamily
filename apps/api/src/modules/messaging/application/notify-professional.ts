// Job `messaging.notify-professional` (UC-MKT-21, BR-MKT-41): e-mail GENÉRICO ao profissional quando a família escreve, no máximo 1 cada
// 30 min por conversa (`professional_notified_at`), idempotente (jobs repetidos/concorrentes ⇒ um só envio) e com *retry* (o erro
// relança-se SEM causa nem destinatário: o e-mail e o conteúdo nunca vão para logs, BR-MKT-46). O e-mail não leva texto, rótulo, nome
// da família/membro nem ids (`ProfessionalMailer`). Profissional sem conta ⇒ descarta.
import type { MessagingClock, ConversationRepository, ProfessionalLookup, ProfessionalMailer, WithTransaction } from "./ports.js";

export interface NotifyProfessionalDeps<Trx> {
  conversations: Pick<ConversationRepository<Trx>, "claimProfessionalNotice" | "releaseProfessionalNotice">;
  professionals: Pick<ProfessionalLookup, "getNotificationEmail">;
  mailer: ProfessionalMailer;
  withTransaction: WithTransaction<Trx>;
  clock: MessagingClock;
}

export type NotifyResult = "SENT" | "SKIPPED";

export function createNotifyProfessional<Trx>(deps: NotifyProfessionalDeps<Trx>) {
  return async function notifyProfessional(conversationId: string): Promise<NotifyResult> {
    const claimedAt = deps.clock.now();
    const claim = await deps.withTransaction((trx) => deps.conversations.claimProfessionalNotice(trx, conversationId, claimedAt));
    if (!claim) return "SKIPPED";
    const release = () => deps.withTransaction((trx) => deps.conversations.releaseProfessionalNotice(trx, conversationId, claimedAt, claim.previous));
    const email = await deps.professionals.getNotificationEmail(claim.professionalId);
    if (!email) {
      await release();
      return "SKIPPED";
    }
    try {
      await deps.mailer.sendNewMessageNotice(email);
    } catch {
      await release();
      throw new Error("professional_notice_failed");
    }
    return "SENT";
  };
}

export type NotifyProfessional = ReturnType<typeof createNotifyProfessional<unknown>>;
