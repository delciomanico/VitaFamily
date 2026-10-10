// Entidade pura `NotificationPreference` (entities.md "Identidade e acesso"; schema.md §1):
// 1:1 com `User`. Posse do módulo `notifications` (modules.md §2: "preferências, subscrições,
// retry"), apesar de entities.md a listar junto de `User` — mesmo critério de `blood_type`
// (`families`) vs `health-records`. Sem I/O.

/** Tipo de alerta tal como aparece em `alerts.type` (entities.md) — `notifications` nunca
 * depende de `alerts` (modules.md §2; nota 15), por isso duplica aqui só os 4 valores que
 * precisa para decidir se o tipo está ativo nas preferências do destinatário. */
export type AlertNotificationType = "MEDICATION_DUE" | "APPOINTMENT_REMINDER" | "EXAM_REMINDER" | "APPOINTMENT_OUTCOME_REQUEST";

export type Channel = "PUSH" | "EMAIL";

export interface NotificationPreference {
  userId: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  medicationDue: boolean;
  appointmentReminder: boolean;
  examReminder: boolean;
}

/** R9: todos os defaults a verdadeiro (schema.md §1) — usado quando o User ainda não tem linha própria. */
export function defaultPreference(userId: string): NotificationPreference {
  return { userId, pushEnabled: true, emailEnabled: true, medicationDue: true, appointmentReminder: true, examReminder: true };
}

/** BR-ALR-04/Q3: "tipo" decide se o alerta chega a existir para este destinatário (UC-ALR-05) —
 * `APPOINTMENT_OUTCOME_REQUEST` partilha o interruptor de `appointmentReminder` (entities.md não
 * prevê uma preferência própria para o pedido de desfecho; mesma categoria "consulta"). */
export function isTypeEnabled(preference: NotificationPreference, type: AlertNotificationType): boolean {
  switch (type) {
    case "MEDICATION_DUE":
      return preference.medicationDue;
    case "APPOINTMENT_REMINDER":
    case "APPOINTMENT_OUTCOME_REQUEST":
      return preference.appointmentReminder;
    case "EXAM_REMINDER":
      return preference.examReminder;
    default:
      return true;
  }
}

/** Canais ativos (UC-ALR-02: "notificações pedidas para os canais ativos do destinatário"). */
export function activeChannels(preference: NotificationPreference): Channel[] {
  const channels: Channel[] = [];
  if (preference.pushEnabled) channels.push("PUSH");
  if (preference.emailEnabled) channels.push("EMAIL");
  return channels;
}

export interface NotificationPreferenceChanges {
  pushEnabled?: boolean;
  emailEnabled?: boolean;
  medicationDue?: boolean;
  appointmentReminder?: boolean;
  examReminder?: boolean;
}

export function applyPreferenceChanges(preference: NotificationPreference, changes: NotificationPreferenceChanges): NotificationPreference {
  return { ...preference, ...changes };
}
