// Regras puras do scanner de alertas (ADR-009; architecture.md §5; entities.md "Alert"): cada
// função devolve o instante UTC em que a regra fica satisfeita, a partir de valores fixos (R9,
// BR-APT-05) — nenhuma regra é configurável em BD (ADR-009 "Justificação"). Sem I/O.

export type AlertType = "MEDICATION_DUE" | "APPOINTMENT_REMINDER" | "EXAM_REMINDER" | "APPOINTMENT_OUTCOME_REQUEST";
export type AlertSourceType = "DOSE" | "APPOINTMENT" | "EXAMINATION";

/** entities.md "Alert": `ruleKey` fixo por regra. */
export type RuleKey = "dose.due" | "dose.repeat" | "appointment.24h" | "appointment.2h" | "appointment.outcome" | "exam.24h";

export interface Rule {
  ruleKey: RuleKey;
  type: AlertType;
  triggerAt: Date;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Q3/BR-ALR-03: lembrete de toma no horário. */
export const DOSE_REPEAT_DELAY_MS = 15 * MINUTE_MS;
/** BR-APT-03/BR-APT-05: lembretes fixos de consulta, 24h e 2h antes. */
export const APPOINTMENT_REMINDER_24H_MS = 24 * HOUR_MS;
export const APPOINTMENT_REMINDER_2H_MS = 2 * HOUR_MS;
/** BR-APT-02/Q4: pedido de confirmação do desfecho, 24h depois da consulta passada sem atualização. */
export const APPOINTMENT_OUTCOME_DELAY_MS = 24 * HOUR_MS;
/** BR-EXM-03: lembrete de exame, 24h antes. */
export const EXAM_REMINDER_24H_MS = 24 * HOUR_MS;

/** UC-ALR-01/BR-ALR-03: `dose.due` no horário; `dose.repeat` 15 min depois, só se ainda não
 * confirmada (quem chama já filtrou por `PENDING`/`UNCONFIRMED`, `medications.listReminderCandidates`). */
export function doseRules(scheduledAt: Date): Rule[] {
  return [
    { ruleKey: "dose.due", type: "MEDICATION_DUE", triggerAt: scheduledAt },
    { ruleKey: "dose.repeat", type: "MEDICATION_DUE", triggerAt: new Date(scheduledAt.getTime() + DOSE_REPEAT_DELAY_MS) },
  ];
}

/** UC-ALR-01/BR-APT-03: lembretes 24h/2h antes de uma consulta `SCHEDULED` futura. */
export function appointmentReminderRules(scheduledAt: Date): Rule[] {
  return [
    { ruleKey: "appointment.24h", type: "APPOINTMENT_REMINDER", triggerAt: new Date(scheduledAt.getTime() - APPOINTMENT_REMINDER_24H_MS) },
    { ruleKey: "appointment.2h", type: "APPOINTMENT_REMINDER", triggerAt: new Date(scheduledAt.getTime() - APPOINTMENT_REMINDER_2H_MS) },
  ];
}

/** UC-APT-04/BR-APT-02/Q4: pedido de confirmação do desfecho de uma consulta `SCHEDULED` passada. */
export function appointmentOutcomeRule(scheduledAt: Date): Rule {
  return { ruleKey: "appointment.outcome", type: "APPOINTMENT_OUTCOME_REQUEST", triggerAt: new Date(scheduledAt.getTime() + APPOINTMENT_OUTCOME_DELAY_MS) };
}

/** BR-EXM-03: lembrete 24h antes de um exame `SCHEDULED` futuro. `examMidnightUtc` é a meia-noite
 * local (fuso efetivo do sujeito, Q8) do `examDate`, já convertida para UTC por quem chama
 * (`timezone.ts`) — `examinations.examDate` não guarda hora (entities.md), por isso "24h antes"
 * lê-se aqui como "à meia-noite local do dia anterior ao exame" (decisão registada em README.md). */
export function examReminderRule(examMidnightUtc: Date): Rule {
  return { ruleKey: "exam.24h", type: "EXAM_REMINDER", triggerAt: new Date(examMidnightUtc.getTime() - EXAM_REMINDER_24H_MS) };
}

/**
 * `dedupeKey` único (entities.md "Alert"; ADR-009): inclui `triggerAt` para que editar o recurso
 * (BR-APT-03: "editar/cancelar recalcula/remove lembretes futuros") produza uma chave nova em vez
 * de reutilizar a de um agendamento antigo já notificado — sem isto, reagendar uma consulta depois
 * de o lembrete das 24h já ter disparado bloquearia o lembrete da nova data (mesma `sourceId`).
 */
export function buildDedupeKey(ruleKey: RuleKey, sourceId: string, recipientUserId: string, triggerAt: Date): string {
  return `${ruleKey}:${sourceId}:${recipientUserId}:${triggerAt.toISOString()}`;
}
