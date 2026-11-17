// Alerta `message.received` (BR-MKT-41, emenda a BR-ALR-01; UC-MKT-19): nasce quando o PROFISSIONAL escreve, na MESMA transação da
// mensagem. Quem chama é `messaging`, ligado a esta função só no composition root — `alerts` não o importa. Destinatários SÓ
// `SELF`/`TUTOR_OF` do membro-sujeito; `dedupeKey` = (regra, conversa, destinatário, familyReadSeq) ⇒ no máximo UM alerta por conversa
// até a família a ler. Texto sempre genérico (BR-MKT-46, BR-ALR-07/08): o alerta guarda só tipo/origem (a conversa), nunca texto,
// rótulo nem nome do profissional. Sem interruptor de tipo próprio (sempre ativo; os canais continuam desligáveis, BR-ALR-04).
import { newId } from "../../../platform/ids/index.js";
import { resolveSelfOrTutorRecipients } from "../domain/recipients.js";
import { buildMessageDedupeKey, messageReceivedRule } from "../domain/rule.js";
import type { AlertsEventDeps } from "./raise-exam-event.js";

export interface RaiseMessageEventInput {
  conversationId: string;
  familyId: string;
  memberId: string;
  /** Marcador de leitura da família no momento da mensagem (entra no `dedupeKey`). */
  familyReadSeq: number;
}

/** Devolve quantos alertas foram criados (um por destinatário). */
export function createRaiseMessageEventUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function raiseMessageEvent(trx: Trx, input: RaiseMessageEventInput): Promise<number> {
    const now = deps.clock.now();
    const member = await deps.families.findMemberById(trx, input.familyId, input.memberId);
    if (!member) {
      return 0;
    }
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, input.familyId, input.memberId) : [];
    const rule = messageReceivedRule(now);

    let created = 0;
    for (const recipientUserId of resolveSelfOrTutorRecipients(member, guardianUserIds)) {
      if (!(await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type))) {
        continue;
      }
      const alert = await deps.alertsRepo.insertIfNew(trx, {
        id: newId(),
        recipientUserId,
        familyId: input.familyId,
        memberId: input.memberId,
        type: rule.type,
        sourceType: "CONVERSATION",
        sourceId: input.conversationId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildMessageDedupeKey(input.conversationId, recipientUserId, input.familyReadSeq),
        triggerAt: rule.triggerAt,
        createdAt: now,
      });
      if (alert) {
        created += 1;
        await deps.notifications.enqueueForAlert(trx, { alertId: alert.id, recipientUserId });
      }
    }
    return created;
  };
}

export interface MarkSourceReadInput {
  sourceType: "CONVERSATION";
  sourceId: string;
}

/** Marca como lidos os alertas da origem (todos os destinatários: o marcador da família é partilhado) e cancela os envios pendentes. */
export function createMarkSourceReadUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function markSourceRead(trx: Trx, input: MarkSourceReadInput): Promise<number> {
    const ids = await deps.alertsRepo.markReadBySource(trx, input.sourceType, input.sourceId, deps.clock.now());
    for (const alertId of ids) {
      await deps.notifications.skipPendingForAlert(trx, alertId);
    }
    return ids.length;
  };
}
