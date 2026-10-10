// Job `alerts.scan` (modules.md §5, 1 min; ADR-009): Evento → Regra → Alerta (→ Notificação, via
// `notifications.enqueueForAlert`, modules.md §2 nota 15). Processo de sistema (worker) — nunca
// autoriza nada (sem `policy`/ator; mesmo critério de `medications` `generate-doses-job.ts`).
import { newId } from "../../../platform/ids/index.js";
import type { AlertSourceType } from "../domain/alert.js";
import { resolveRecipients } from "../domain/recipients.js";
import {
  APPOINTMENT_OUTCOME_DELAY_MS,
  appointmentOutcomeRule,
  appointmentReminderRules,
  buildDedupeKey,
  doseRules,
  examReminderRule,
  type Rule,
} from "../domain/rule.js";
import { localMidnightUtc } from "../domain/timezone.js";
import type { AlertsWorkerDeps } from "./ports.js";

const BATCH_SIZE = 500;
/** Margem dos dois lados do dia atual para cobrir qualquer fuso efetivo (±14h no mundo real); o
 * instante exato do lembrete é sempre recalculado por `localMidnightUtc` depois. */
const EXAM_DATE_WINDOW_DAYS = 2;

export interface ScanJobResult {
  alertsCreated: number;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createScanJobUseCase<Trx>(deps: AlertsWorkerDeps<Trx>) {
  async function processCandidate(
    trx: Trx,
    now: Date,
    ctx: { familyId: string; memberId: string; sourceType: AlertSourceType; sourceId: string; rules: Rule[] },
  ): Promise<number> {
    const dueRules = ctx.rules.filter((rule) => rule.triggerAt.getTime() <= now.getTime());
    if (dueRules.length === 0) {
      return 0;
    }

    const member = await deps.families.findMemberById(trx, ctx.familyId, ctx.memberId);
    if (!member) {
      // Defensivo: nunca deveria acontecer (FK composta, ADR-008) — não bloqueia o resto do scan.
      return 0;
    }
    const guardianUserIds = member.isDependent ? await deps.families.listGuardianUserIds(trx, ctx.familyId, ctx.memberId) : [];
    const recipients = resolveRecipients(member, guardianUserIds);

    let created = 0;
    for (const rule of dueRules) {
      for (const recipientUserId of recipients) {
        // Q3/UC-ALR-05: tipo desativado ⇒ nem o alerta chega a existir para este destinatário.
        const typeEnabled = await deps.notifications.isTypeEnabled(trx, recipientUserId, rule.type);
        if (!typeEnabled) {
          continue;
        }
        const dedupeKey = buildDedupeKey(rule.ruleKey, ctx.sourceId, recipientUserId, rule.triggerAt);
        const alert = await deps.alertsRepo.insertIfNew(trx, {
          id: newId(),
          recipientUserId,
          familyId: ctx.familyId,
          memberId: ctx.memberId,
          type: rule.type,
          sourceType: ctx.sourceType,
          sourceId: ctx.sourceId,
          ruleKey: rule.ruleKey,
          dedupeKey,
          triggerAt: rule.triggerAt,
          createdAt: now,
        });
        if (alert) {
          created += 1;
          await deps.notifications.enqueueForAlert(trx, { alertId: alert.id, recipientUserId });
        }
      }
    }
    return created;
  }

  return async function scanJob(): Promise<ScanJobResult> {
    const now = deps.clock.now();
    let alertsCreated = 0;

    await deps.withTransaction(async (trx) => {
      const doses = await deps.medications.listReminderCandidates(trx, now, BATCH_SIZE);
      for (const dose of doses) {
        alertsCreated += await processCandidate(trx, now, {
          familyId: dose.familyId,
          memberId: dose.memberId,
          sourceType: "DOSE",
          sourceId: dose.id,
          rules: doseRules(dose.scheduledAt),
        });
      }

      const appointments = await deps.appointments.listReminderCandidates(trx, now, APPOINTMENT_OUTCOME_DELAY_MS, BATCH_SIZE);
      for (const appointment of appointments) {
        const isOutcomeCandidate = appointment.scheduledAt.getTime() + APPOINTMENT_OUTCOME_DELAY_MS <= now.getTime();
        const rules = isOutcomeCandidate ? [appointmentOutcomeRule(appointment.scheduledAt)] : appointmentReminderRules(appointment.scheduledAt);
        alertsCreated += await processCandidate(trx, now, {
          familyId: appointment.familyId,
          memberId: appointment.memberId,
          sourceType: "APPOINTMENT",
          sourceId: appointment.id,
          rules,
        });
        if (isOutcomeCandidate) {
          // BR-APT-02: regista o pedido feito (único escritor, `appointments/README.md`) —
          // independente de quantos destinatários acabaram notificados, para não voltar a
          // selecionar esta consulta em todos os scans seguintes.
          await deps.appointments.setOutcomeRequested(trx, appointment.id, now);
        }
      }

      const windowStart = new Date(now.getTime() - EXAM_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + EXAM_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const examinations = await deps.examinations.listReminderCandidates(trx, toDateOnly(windowStart), toDateOnly(windowEnd), BATCH_SIZE);
      for (const examination of examinations) {
        const timeZone = await deps.families.getEffectiveTimezone(trx, examination.familyId, examination.memberId);
        const midnightUtc = localMidnightUtc(examination.examDate, timeZone);
        alertsCreated += await processCandidate(trx, now, {
          familyId: examination.familyId,
          memberId: examination.memberId,
          sourceType: "EXAMINATION",
          sourceId: examination.id,
          rules: [examReminderRule(midnightUtc)],
        });
      }
    });

    return { alertsCreated };
  };
}
