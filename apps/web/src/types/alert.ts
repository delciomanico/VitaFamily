/** Alerta para um destinatário (docs/04-domain/entities.md → Alert). */
export type AlertType =
  | 'MEDICATION_DUE'
  | 'APPOINTMENT_REMINDER'
  | 'EXAM_REMINDER'
  | 'APPOINTMENT_OUTCOME_REQUEST'
  | 'APPOINTMENT_CONFIRMED'
  | 'APPOINTMENT_REJECTED'
  | 'APPOINTMENT_CANCELLED'

/** Regra que gerou o alerta (Evento → Regra → Alerta, UC-ALR-01). */
export type AlertRuleKey =
  | 'dose.due'
  | 'dose.repeat'
  | 'appointment.24h'
  | 'appointment.2h'
  | 'exam.24h'
  | 'appointment.outcome'
  | 'appointment.confirmed'
  | 'appointment.rejected'
  | 'appointment.cancelled'

export interface HealthAlert {
  id: string
  familyId: string
  /** Membro a quem o alerta diz respeito. */
  memberId: string
  type: AlertType
  ruleKey: AlertRuleKey
  sourceType: 'DOSE' | 'APPOINTMENT' | 'EXAMINATION'
  sourceId: string
  triggerAt: string
  readAt?: string
}

/** Alerta pronto a mostrar: inclui o nome do membro e um resumo da origem. */
export interface AlertItem extends HealthAlert {
  memberName: string
  /** Ex.: “Amoxicilina 500 mg”, “Cardiologia”, “Análises clínicas”. */
  sourceLabel: string
  /** Quando acontece a origem (toma, consulta ou exame). */
  sourceAt?: string
  /** Recurso a abrir: plano do medicamento, consulta ou exame. */
  targetId?: string
}

/** Grupos do centro de alertas. */
export type AlertCategory = 'MEDICATION' | 'APPOINTMENTS' | 'EXAMS' | 'FOLLOW_UP'
