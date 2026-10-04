import type { DoseOccurrence, MedicationPlan } from '@/types/medication'
import type { Prescription } from '@/types/prescription'
import { at, day } from '../time'

/** Depois de 2 h sem ação, uma toma pendente passa a não confirmada (BR-MED-03). */
export const UNCONFIRMED_AFTER_HOURS = 2

export const AMOXICILLIN_TIMES = ['08:00', '16:00', '22:00']

export function seedPrescriptions(now: Date = new Date()): Prescription[] {
  const base = { familyId: 'fam_monarca' }
  return [
    {
      ...base,
      id: 'rx_amox',
      memberId: 'mem_monarca',
      issuedOn: day(-2, now),
      doctorName: 'Dr. Tiago Alves',
      clinicName: 'Centro de Saúde do Bairro',
      status: 'ACTIVE',
    },
    {
      ...base,
      id: 'rx_joao',
      memberId: 'mem_joao',
      issuedOn: day(-60, now),
      doctorName: 'Dr. Paulo Neto',
      clinicName: 'Centro de Saúde do Bairro',
      status: 'ACTIVE',
    },
    {
      ...base,
      id: 'rx_pedro',
      memberId: 'mem_pedro',
      issuedOn: day(-120, now),
      doctorName: 'Dr. Rui Mendes',
      clinicName: 'Clínica Horizonte',
      status: 'COMPLETED',
    },
  ]
}

export function seedMedicationPlans(now: Date = new Date()): MedicationPlan[] {
  const base = { familyId: 'fam_monarca', scheduleType: 'FIXED_TIMES' as const }
  return [
    {
      ...base,
      id: 'med_amox',
      memberId: 'mem_monarca',
      prescriptionId: 'rx_amox',
      name: 'Amoxicilina',
      dosage: '500 mg',
      times: AMOXICILLIN_TIMES,
      startAt: at(-2, '08:00', now),
      endAt: at(5, '22:00', now),
      continuous: false,
      notes: 'Tomar depois das refeições.',
      status: 'ACTIVE',
    },
    {
      ...base,
      id: 'med_metformina',
      memberId: 'mem_joao',
      prescriptionId: 'rx_joao',
      name: 'Metformina',
      dosage: '850 mg',
      times: ['08:00', '20:00'],
      startAt: at(-60, '08:00', now),
      continuous: true,
      status: 'ACTIVE',
    },
    {
      ...base,
      id: 'med_losartana',
      memberId: 'mem_joao',
      prescriptionId: 'rx_joao',
      name: 'Losartana',
      dosage: '50 mg',
      times: ['09:00'],
      startAt: at(-60, '09:00', now),
      continuous: true,
      status: 'ACTIVE',
    },
    {
      ...base,
      id: 'med_vitd',
      memberId: 'mem_pedro',
      prescriptionId: 'rx_pedro',
      name: 'Vitamina D',
      dosage: '400 UI',
      times: ['09:00'],
      startAt: at(-120, '09:00', now),
      endAt: at(-30, '09:00', now),
      continuous: false,
      status: 'ENDED',
      endedAt: at(-30, '09:00', now),
    },
  ]
}

/** Planos cujas tomas passadas de hoje ficaram sem confirmação (para mostrar pendências). */
const FORGOTTEN_PLANS = new Set(['med_metformina'])

/**
 * Tomas de hoje dos planos ativos. As já passadas ficam tomadas, salvo nos planos
 * “esquecidos”, que após 2 h ficam não confirmadas; as restantes ficam pendentes.
 */
export function seedDoses(plans: MedicationPlan[], now: Date = new Date()): DoseOccurrence[] {
  const unconfirmedBefore = now.getTime() - UNCONFIRMED_AFTER_HOURS * 3_600_000

  return plans
    .filter((plan) => plan.status === 'ACTIVE')
    .flatMap((plan) =>
      (plan.times ?? []).map((time): DoseOccurrence => {
        const scheduledAt = at(0, time, now)
        const overdue = Date.parse(scheduledAt) < unconfirmedBefore
        const status = !overdue ? 'PENDING' : FORGOTTEN_PLANS.has(plan.id) ? 'UNCONFIRMED' : 'TAKEN'
        return {
          id: `dose_${plan.id}_${time.replace(':', '')}`,
          familyId: plan.familyId,
          memberId: plan.memberId,
          planId: plan.id,
          scheduledAt,
          status,
          actedAt: status === 'TAKEN' ? scheduledAt : undefined,
        }
      }),
    )
}
