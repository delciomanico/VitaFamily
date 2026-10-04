import type { AlertRuleKey, AlertType, HealthAlert } from '@/types/alert'
import type { Appointment } from '@/types/appointment'
import type { Examination } from '@/types/examination'
import type { FamilyMember } from '@/types/family'
import type { DoseOccurrence, MedicationPlan } from '@/types/medication'
import type { MockGuardianship } from './data/families'

/*
 * Evento → Regra → Alerta (UC-ALR-01). O backend corre isto num job; os mocks correm-no
 * sempre que os alertas são lidos. A notificação externa (push/e-mail) é do backend.
 */

/** Alerta mock com o destinatário e a chave de idempotência (no domínio: recipientUserId, dedupeKey). */
export interface MockAlert extends HealthAlert {
  recipientUserId: string
  dedupeKey: string
}

/** Repetição do lembrete de toma não confirmada (BR-ALR-03). */
export const DOSE_REPEAT_MINUTES = 15
/** Lembretes de consulta, por ordem: o mais cedo primeiro (R9). */
export const APPOINTMENT_REMINDER_HOURS = [24, 2] as const
/** Lembrete de exame (R9). */
export const EXAM_REMINDER_HOURS = 24

const HOUR = 3_600_000

/** O que o scanner lê da “base de dados”. */
export interface AlertSources {
  members: FamilyMember[]
  guardianships: MockGuardianship[]
  medicationPlans: MedicationPlan[]
  doses: DoseOccurrence[]
  appointments: Appointment[]
  examinations: Examination[]
  alerts: MockAlert[]
}

/** Facto que pode gerar alertas: um por destinatário. */
export interface AlertEvent {
  familyId: string
  memberId: string
  type: AlertType
  ruleKey: AlertRuleKey
  sourceType: HealthAlert['sourceType']
  sourceId: string
  triggerAt: string
  /** Identifica a ocorrência (ex.: data da consulta), para recalcular se a origem mudar. */
  occurrence: string
}

/** Destinatários (FR-ALR-08): o próprio, se tiver conta, e os tutores. */
export function recipientsOf(data: Pick<AlertSources, 'members' | 'guardianships'>, memberId: string): string[] {
  const userOf = (id: string) => data.members.find((m) => m.id === id && m.status === 'ACTIVE')?.userId
  const ids = [memberId, ...data.guardianships.filter((g) => g.dependentId === memberId).map((g) => g.guardianId)]
  return [...new Set(ids.map(userOf).filter((id): id is string => Boolean(id)))]
}

/** Início do dia local de uma data ISO (yyyy-mm-dd). */
function startOfDay(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

/** Eventos já chegados à hora (as regras por defeito de R9; preferências na fase de Configurações). */
export function dueEvents(data: AlertSources, now: Date): AlertEvent[] {
  const t = now.getTime()
  const events: AlertEvent[] = []
  const iso = (ms: number) => new Date(ms).toISOString()

  for (const dose of data.doses) {
    const plan = data.medicationPlans.find((p) => p.id === dose.planId)
    if (plan?.status !== 'ACTIVE') continue
    const at = Date.parse(dose.scheduledAt)
    const base = { familyId: dose.familyId, memberId: dose.memberId, type: 'MEDICATION_DUE' as const }
    const source = { sourceType: 'DOSE' as const, sourceId: dose.id, occurrence: dose.scheduledAt }
    if (at <= t) events.push({ ...base, ...source, ruleKey: 'dose.due', triggerAt: dose.scheduledAt })
    // Repete uma vez se ainda não foi confirmada (tomada ou não tomada).
    const repeat = at + DOSE_REPEAT_MINUTES * 60_000
    if (repeat <= t && (dose.status === 'PENDING' || dose.status === 'UNCONFIRMED')) {
      events.push({ ...base, ...source, ruleKey: 'dose.repeat', triggerAt: iso(repeat) })
    }
  }

  for (const appointment of data.appointments) {
    if (appointment.status !== 'SCHEDULED') continue
    const start = Date.parse(appointment.scheduledAt)
    const base = {
      familyId: appointment.familyId,
      memberId: appointment.memberId,
      sourceType: 'APPOINTMENT' as const,
      sourceId: appointment.id,
      occurrence: appointment.scheduledAt,
    }
    if (start > t) {
      // Só o lembrete mais próximo que já chegou à hora (marcada à última hora → não envia os dois).
      const due = APPOINTMENT_REMINDER_HOURS.filter((hours) => start - hours * HOUR <= t).at(-1)
      if (due) {
        events.push({
          ...base,
          type: 'APPOINTMENT_REMINDER',
          ruleKey: due === 24 ? 'appointment.24h' : 'appointment.2h',
          triggerAt: iso(start - due * HOUR),
        })
      }
    } else {
      // Passou e continua AGENDADA: pedir o desfecho, nunca assumir (Q4).
      events.push({
        ...base,
        type: 'APPOINTMENT_OUTCOME_REQUEST',
        ruleKey: 'appointment.outcome',
        triggerAt: appointment.scheduledAt,
      })
    }
  }

  for (const examination of data.examinations) {
    if (examination.status !== 'SCHEDULED') continue
    // O exame tem só data: o lembrete conta a partir do início desse dia, até ao fim do dia.
    const start = startOfDay(examination.examDate)
    const trigger = start - EXAM_REMINDER_HOURS * HOUR
    if (trigger <= t && t < start + 24 * HOUR) {
      events.push({
        familyId: examination.familyId,
        memberId: examination.memberId,
        type: 'EXAM_REMINDER',
        ruleKey: 'exam.24h',
        sourceType: 'EXAMINATION',
        sourceId: examination.id,
        triggerAt: iso(trigger),
        occurrence: examination.examDate,
      })
    }
  }

  return events
}

/** Cria os alertas em falta: no máximo um por evento, regra e destinatário (BR-ALR-02). */
export function raiseAlerts(data: AlertSources, events: AlertEvent[]): MockAlert[] {
  const known = new Set(data.alerts.map((a) => a.dedupeKey))
  const created: MockAlert[] = []
  for (const { occurrence, ...event } of events) {
    for (const recipientUserId of recipientsOf(data, event.memberId)) {
      const dedupeKey = `${event.ruleKey}:${event.sourceId}:${occurrence}:${recipientUserId}`
      if (known.has(dedupeKey)) continue
      known.add(dedupeKey)
      created.push({ ...event, id: `alr_${created.length + data.alerts.length + 1}`, recipientUserId, dedupeKey })
    }
  }
  data.alerts.push(...created)
  return created
}

/** Corre as regras de agenda até `now`. */
export function scanAlerts(data: AlertSources, now: Date): MockAlert[] {
  return raiseAlerts(data, dueEvents(data, now))
}
