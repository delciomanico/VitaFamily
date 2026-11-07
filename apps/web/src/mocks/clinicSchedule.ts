import type { Appointment } from '@/types/appointment'
import type { Examination } from '@/types/examination'
import {
  SCHEDULE_HORIZON_DAYS,
  type ClinicProfessional,
  type ClinicScheduleRule,
  type ClinicServiceType,
  type ClinicSlot,
  type ClinicTimeOff,
  type ScheduleGeneration,
} from '@/types/clinic'

/*
 * Motor de geração de horários do mock (BR-CLN-12..15). Funciona sobre um “store” mínimo (a
 * própria `db`, ou os dados em construção no seed) para não depender de `db.ts` (evita ciclos).
 */

export interface ScheduleStore {
  slots: ClinicSlot[]
  appointments: Appointment[]
  examinations: Examination[]
  professionals: Array<ClinicProfessional & { clinicId: string }>
  services: Array<ClinicServiceType & { clinicId: string }>
  scheduleRules: Array<ClinicScheduleRule & { clinicId: string }>
  timeOffs: Array<ClinicTimeOff & { clinicId: string }>
}

const MINUTE = 60_000

export const emptyGeneration = (): ScheduleGeneration => ({
  created: 0,
  unchanged: 0,
  removed: 0,
  skippedOverlap: 0,
  skippedTimeOff: 0,
  keptBooked: 0,
})

/** Dia da semana ISO (1 = segunda ... 7 = domingo) de uma data local. */
export const isoWeekday = (date: Date) => date.getDay() || 7

const toMinutes = (time: string) => {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Horário com marcação ativa (consulta pedida/agendada ou exame agendado). */
export function isBooked(store: ScheduleStore, slotId: string): boolean {
  return (
    store.appointments.some((a) => a.slotId === slotId && (a.status === 'REQUESTED' || a.status === 'SCHEDULED')) ||
    store.examinations.some((e) => e.slotId === slotId && e.status === 'SCHEDULED')
  )
}

export function bookedCountOf(store: ScheduleStore, slot: ClinicSlot): number {
  return slot.kind === 'EXAM'
    ? store.examinations.filter((e) => e.slotId === slot.id && e.status === 'SCHEDULED').length
    : store.appointments.filter((a) => a.slotId === slot.id && (a.status === 'REQUESTED' || a.status === 'SCHEDULED'))
        .length
}

const intersects = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** Intervalo semiaberto do horário em ms. */
const span = (slot: Pick<ClinicSlot, 'startsAt' | 'durationMinutes'>): [number, number] => {
  const start = Date.parse(slot.startsAt)
  return [start, start + slot.durationMinutes * MINUTE]
}

/** Horário (do mesmo profissional) que se sobrepõe ao intervalo, se existir (BR-CLN-13). */
export function overlappingSlot(
  store: ScheduleStore,
  professionalId: string,
  startsAt: string,
  durationMinutes: number,
): ClinicSlot | undefined {
  const [start, end] = span({ startsAt, durationMinutes })
  return store.slots.find((s) => {
    if (s.professionalId !== professionalId) return false
    const [sStart, sEnd] = span(s)
    return intersects(start, end, sStart, sEnd)
  })
}

/** Bloqueio do profissional que intersecta o intervalo (BR-CLN-14). */
export function timeOffAt(
  store: ScheduleStore,
  professionalId: string,
  startsAt: string,
  durationMinutes: number,
): ClinicTimeOff | undefined {
  const [start, end] = span({ startsAt, durationMinutes })
  return store.timeOffs.find(
    (t) => t.professionalId === professionalId && intersects(start, end, Date.parse(t.startsAt), Date.parse(t.endsAt)),
  )
}

/** Instantes (ISO) que a regra prevê na janela de 8 semanas, só futuros. */
export function expectedStarts(rule: ClinicScheduleRule, durationMinutes: number, now: Date): string[] {
  const out: string[] = []
  const start = toMinutes(rule.startTime)
  const end = toMinutes(rule.endTime)
  for (let offset = 0; offset <= SCHEDULE_HORIZON_DAYS; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    const key = dayKey(day)
    if (!rule.weekdays.includes(isoWeekday(day))) continue
    if (rule.validFrom && key < rule.validFrom) continue
    if (rule.validUntil && key > rule.validUntil) continue
    for (let minutes = start; minutes + durationMinutes <= end; minutes += durationMinutes) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes)
      if (at.getTime() > now.getTime()) out.push(at.toISOString())
    }
  }
  return out
}

/** Duas regras ativas do mesmo profissional sobrepõem-se (dia ∩ horas ∩ validade) — BR-CLN-13. */
export function rulesOverlap(a: ClinicScheduleRule, b: ClinicScheduleRule): boolean {
  if (!a.weekdays.some((d) => b.weekdays.includes(d))) return false
  if (!intersects(toMinutes(a.startTime), toMinutes(a.endTime), toMinutes(b.startTime), toMinutes(b.endTime))) {
    return false
  }
  const aFrom = a.validFrom ?? '0000-00-00'
  const bFrom = b.validFrom ?? '0000-00-00'
  const aUntil = a.validUntil ?? '9999-99-99'
  const bUntil = b.validUntil ?? '9999-99-99'
  return aFrom <= bUntil && bFrom <= aUntil
}

/**
 * Gera e reconcilia os horários de uma regra (idempotente). Regra/profissional/serviço inativos
 * só reconciliam (removem livres futuros), nunca geram. Marcações nunca se alteram (BR-CLN-15).
 */
export function generateRule(store: ScheduleStore, ruleId: string, now: Date): ScheduleGeneration {
  const generation = emptyGeneration()
  const rule = store.scheduleRules.find((r) => r.id === ruleId)
  if (!rule) return generation
  const professional = store.professionals.find((p) => p.id === rule.professionalId)
  const service = store.services.find((s) => s.id === rule.serviceTypeId)
  if (!professional || !service) return generation
  const live = rule.active && professional.active && service.active
  const expected = live ? expectedStarts(rule, service.durationMinutes, now) : []
  const expectedSet = new Set(expected)

  // Reconciliação: o que a regra já não prevê.
  const stale = store.slots.filter(
    (s) => s.scheduleRuleId === rule.id && Date.parse(s.startsAt) > now.getTime() && !expectedSet.has(s.startsAt),
  )
  for (const slot of stale) {
    if (isBooked(store, slot.id)) generation.keptBooked++
    else {
      store.slots = store.slots.filter((s) => s.id !== slot.id)
      generation.removed++
    }
  }

  for (const startsAt of expected) {
    if (store.slots.some((s) => s.scheduleRuleId === rule.id && s.startsAt === startsAt)) {
      generation.unchanged++
    } else if (timeOffAt(store, rule.professionalId, startsAt, service.durationMinutes)) {
      generation.skippedTimeOff++
    } else if (overlappingSlot(store, rule.professionalId, startsAt, service.durationMinutes)) {
      generation.skippedOverlap++
    } else {
      store.slots.push({
        id: `slot_${crypto.randomUUID().slice(0, 8)}`,
        clinicId: rule.clinicId,
        kind: service.kind,
        capacity: rule.capacity,
        specialty: service.name,
        professionalName: professional.name,
        professionalId: professional.id,
        serviceTypeId: service.id,
        scheduleRuleId: rule.id,
        startsAt,
        durationMinutes: service.durationMinutes,
      })
      generation.created++
    }
  }
  return generation
}

export function addGeneration(total: ScheduleGeneration, part: ScheduleGeneration): ScheduleGeneration {
  for (const key of Object.keys(total) as Array<keyof ScheduleGeneration>) total[key] += part[key]
  return total
}

/** Gera todas as regras da clínica (job diário `clinics.generate-schedule` ou reconciliação em massa). */
export function generateRules(store: ScheduleStore, rules: ClinicScheduleRule[], now: Date): ScheduleGeneration {
  return rules.reduce((total, rule) => addGeneration(total, generateRule(store, rule.id, now)), emptyGeneration())
}
