// Alertas `booking.updated` e `payment.updated` (BR-MKT-65, emenda a BR-ALR-01; UC-MKT-28/34/36/38): nascem na MESMA transação da mudança de
// estado (confirmar/recusar/cancelar, decisão do comprovativo, decisão da disputa, cancelamento do sistema). Quem chama é `consultations`,
// ligado a esta função só nos composition roots — `alerts` não o importa. Destinatários SÓ `SELF`/`TUTOR_OF` do membro-sujeito;
// `dedupeKey` = (regra, marcação, destinatário, versão do estado). Texto sempre genérico: o alerta guarda só tipo/origem (a marcação), nunca
// nome, hora, valor nem motivo. Sem interruptor de tipo próprio (os canais continuam desligáveis, BR-ALR-04).
import { newId } from "../../../platform/ids/index.js";
import { resolveSelfOrTutorRecipients } from "../domain/recipients.js";
import { bookingUpdatedRule, buildBookingDedupeKey, paymentUpdatedRule } from "../domain/rule.js";
import type { AlertsEventDeps } from "./raise-exam-event.js";

export interface RaiseBookingEventInput {
  kind: "BOOKING_UPDATED" | "PAYMENT_UPDATED";
  bookingId: string;
  familyId: string;
  memberId: string;
  /** Versão do estado (instante da mudança, ISO): uma mudança nova gera um alerta novo; repetir a mesma não. */
  stateVersion: string;
}

/** Devolve quantos alertas foram criados (um por destinatário). */
export function createRaiseBookingEventUseCase<Trx>(deps: AlertsEventDeps<Trx>) {
  return async function raiseBookingEvent(trx: Trx, input: RaiseBookingEventInput): Promise<number> {
    const now = deps.clock.now();
    const member = await deps.families.findMemberById(trx, input.familyId, input.memberId);
    if (!member) return 0;
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, input.familyId, input.memberId) : [];
    const rule = input.kind === "BOOKING_UPDATED" ? bookingUpdatedRule(now) : paymentUpdatedRule(now);

    let created = 0;
    for (const recipientUserId of resolveSelfOrTutorRecipients(member, guardianUserIds)) {
      if (!(await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type))) continue;
      const alert = await deps.alertsRepo.insertIfNew(trx, {
        id: newId(),
        recipientUserId,
        familyId: input.familyId,
        memberId: input.memberId,
        type: rule.type,
        sourceType: "BOOKING",
        sourceId: input.bookingId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildBookingDedupeKey(rule.ruleKey, input.bookingId, recipientUserId, input.stateVersion),
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
