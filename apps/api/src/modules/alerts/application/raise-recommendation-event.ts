// Alerta `recommendation.added` (D19/ADR-023, BR-CLN-09, UC-REC-01): nasce no momento em que a
// clínica emite a recomendação e na MESMA transação (sem recomendação, sem alerta). Quem chama é
// `recommendations`, ligado a esta função só no composition root — `alerts` não importa
// `recommendations` (nenhuma aresta nova). Texto sempre genérico (BR-HLT-05/BR-ALR-07/08): o alerta
// guarda só tipo/origem, nunca o conteúdo da recomendação. Destinatários e preferências como nos
// restantes alertas (`resolveRecipients` + `isTypeEnabled`, UC-ALR-05).
import { newId } from "../../../platform/ids/index.js";
import { resolveRecipients } from "../domain/recipients.js";
import { buildDedupeKey, recommendationAddedRule } from "../domain/rule.js";
import type { AlertsEventDeps } from "./raise-exam-event.js";

export interface RaiseRecommendationEventInput {
  recommendationId: string;
  familyId: string;
  memberId: string;
}

/** Devolve quantos alertas foram criados (um por destinatário com o tipo ativo). */
export function createRaiseRecommendationEventUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function raiseRecommendationEvent(trx: Trx, input: RaiseRecommendationEventInput): Promise<number> {
    const now = deps.clock.now();
    const member = await deps.families.findMemberById(trx, input.familyId, input.memberId);
    if (!member) {
      return 0;
    }
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, input.familyId, input.memberId) : [];
    const recipients = resolveRecipients(member, guardianUserIds);
    const rule = recommendationAddedRule(now);

    let created = 0;
    for (const recipientUserId of recipients) {
      if (!(await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type))) {
        continue;
      }
      const alert = await deps.alertsRepo.insertIfNew(trx, {
        id: newId(),
        recipientUserId,
        familyId: input.familyId,
        memberId: input.memberId,
        type: rule.type,
        sourceType: "RECOMMENDATION",
        sourceId: input.recommendationId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildDedupeKey(rule.ruleKey, input.recommendationId, recipientUserId, rule.triggerAt),
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
