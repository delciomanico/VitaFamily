// Alertas `authorization.*` por transição do pedido à seguradora (ADR-036, BR-ALR-10..12, UC-ALR-07): nascem na MESMA transação da
// transição (sem transição, sem alerta; se o alerta falha, a transição reverte-se), como `exam_order.added` (ADR-028). Quem chama é o
// adaptador da porta `FamilyNotifier` de `insurer-ops`, ligado SÓ no composition root — `insurer-ops` não importa `alerts`.
// Texto: a mensagem in-app é fixa por tipo (`list-alerts.ts`) e a externa é a genérica única (BR-ALR-08); este alerta guarda só
// tipo/origem (o processo) — nunca clínica, serviço, valor, motivo nem estado. Destinatários SÓ `SELF`/`TUTOR_OF` (BR-ALR-11).
import { newId } from "../../../platform/ids/index.js";
import { resolveSelfOrTutorRecipients } from "../domain/recipients.js";
import { authorizationEventRule, buildDedupeKey, type AuthorizationEventKind } from "../domain/rule.js";
import type { AlertsEventDeps } from "./raise-exam-event.js";
import type { AlertsDeps } from "./ports.js";

export interface RaiseAuthorizationEventInput {
  kind: AuthorizationEventKind;
  processId: string;
  /** Pedido que transitou (rastreio; a idempotência usa o processo e o instante, BR-ALR-12). */
  requestId: string;
  occurredAt: Date;
}

export type AuthorizationEventDeps<Trx> = AlertsEventDeps<Trx> & Pick<AlertsDeps<Trx>, "processes">;

/** Devolve quantos alertas foram criados (um por destinatário). */
export function createRaiseAuthorizationEventUseCase<Trx>(deps: AuthorizationEventDeps<Trx>) {
  return async function raiseAuthorizationEvent(trx: Trx, input: RaiseAuthorizationEventInput): Promise<number> {
    const now = deps.clock.now();
    // BR-ALR-10: processo inexistente/apagado ⇒ sem alerta.
    const [target] = await deps.processes.describe(trx, [input.processId]);
    if (!target) return 0;
    const member = await deps.families.findMemberById(trx, target.familyId, target.memberId);
    if (!member) return 0;
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, target.familyId, target.memberId) : [];
    const rule = authorizationEventRule(input.kind, input.occurredAt);

    let created = 0;
    for (const recipientUserId of resolveSelfOrTutorRecipients(member, guardianUserIds)) {
      // Sem interruptor de tipo próprio (BR-ALR-11): `isTypeEnabled` devolve `true`; os canais mandam em `notifications`.
      if (!(await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type))) continue;
      const alert = await deps.alertsRepo.insertIfNew(trx, {
        id: newId(),
        recipientUserId,
        familyId: target.familyId,
        memberId: target.memberId,
        type: rule.type,
        sourceType: "PROCESS",
        sourceId: input.processId,
        ruleKey: rule.ruleKey,
        dedupeKey: buildDedupeKey(rule.ruleKey, input.processId, recipientUserId, rule.triggerAt),
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
