// Alertas de evento de exame de clínica parceira (D19/ADR-023: `exam.confirmed`, `exam.rejected`,
// `exam.cancelled`, `exam.results`; BR-CLN-07/08, UC-CLN-08..10). Ao contrário do scanner
// (`alerts.scan`, por relógio), estes alertas nascem no momento do evento e na MESMA transação da
// ação da clínica/sistema (atómico: sem ação, sem alerta). Quem chama é `examinations`, ligado a esta
// função só no composition root (`examinations/application/ports.ts#ExamAlertsPort`) — `alerts`
// continua a depender de `examinations`, nunca o inverso. Texto sempre genérico (BR-ALR-08): o
// alerta guarda só tipo/origem, nunca resultados nem o motivo da clínica.
import { newId } from "../../../platform/ids/index.js";
import { resolveRecipients } from "../domain/recipients.js";
import { buildDedupeKey, examEventRule, type ExamEventAlertType } from "../domain/rule.js";
import type { AlertsDeps } from "./ports.js";

export type AlertsEventDeps<Trx> = Pick<AlertsDeps<Trx>, "alertsRepo" | "families" | "notifications" | "clock">;

export interface RaiseExamEventInput {
  type: ExamEventAlertType;
  examinationId: string;
  familyId: string;
  memberId: string;
}

/** Devolve quantos alertas foram criados (um por destinatário com o tipo ativo, FR-ALR-08/UC-ALR-05). */
export function createRaiseExamEventUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function raiseExamEvent(trx: Trx, input: RaiseExamEventInput): Promise<number> {
    const now = deps.clock.now();
    const member = await deps.families.findMemberById(trx, input.familyId, input.memberId);
    if (!member) {
      return 0;
    }
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, input.familyId, input.memberId) : [];
    const recipients = resolveRecipients(member, guardianUserIds);
    const rule = examEventRule(input.type, now);

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
        sourceType: "EXAMINATION",
        sourceId: input.examinationId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildDedupeKey(rule.ruleKey, input.examinationId, recipientUserId, rule.triggerAt),
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
