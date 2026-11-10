// Alerta `exam_order.added` (ADR-028, BR-CLN-53, UC-CLN-39): nasce quando o Médico cria o pedido de exame, na MESMA transação (sem
// pedido, sem alerta). Quem chama é `clinic-reports`, ligado a esta função só no composition root — `alerts` não o importa.
// Texto sempre genérico (BR-HLT-05/BR-ALR-07/08): o alerta guarda só tipo/origem (a consulta), nunca o nome do exame, do membro
// nem da clínica. Destinatários SÓ `SELF`/`TUTOR_OF` (`resolveExamOrderRecipients`); sem interruptor próprio.
import { newId } from "../../../platform/ids/index.js";
import { resolveExamOrderRecipients } from "../domain/recipients.js";
import { buildDedupeKey, examOrderAddedRule } from "../domain/rule.js";
import type { AlertsEventDeps } from "./raise-exam-event.js";

export interface RaiseExamOrderEventInput {
  appointmentId: string;
  familyId: string;
  memberId: string;
}

/** Devolve quantos alertas foram criados (um por destinatário). */
export function createRaiseExamOrderEventUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function raiseExamOrderEvent(trx: Trx, input: RaiseExamOrderEventInput): Promise<number> {
    const now = deps.clock.now();
    const member = await deps.families.findMemberById(trx, input.familyId, input.memberId);
    if (!member) {
      return 0;
    }
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, input.familyId, input.memberId) : [];
    const rule = examOrderAddedRule(now);

    let created = 0;
    for (const recipientUserId of resolveExamOrderRecipients(member, guardianUserIds)) {
      if (!(await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type))) {
        continue;
      }
      const alert = await deps.alertsRepo.insertIfNew(trx, {
        id: newId(),
        recipientUserId,
        familyId: input.familyId,
        memberId: input.memberId,
        type: rule.type,
        sourceType: "APPOINTMENT",
        sourceId: input.appointmentId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildDedupeKey(rule.ruleKey, input.appointmentId, recipientUserId, rule.triggerAt),
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
