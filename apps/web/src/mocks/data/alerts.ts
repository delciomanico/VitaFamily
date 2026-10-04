import type { HealthAlert } from '@/types/alert'
import { at, hoursFromNow } from '../time'
import { AMOXICILLIN_TIMES } from './medications'

/** Alerta mock com o destinatário (no domínio: recipientUserId). */
export interface MockAlert extends HealthAlert {
  recipientUserId: string
}

/** Alertas fictícios de Monarca (titular e tutor dos restantes membros). */
export function seedAlerts(now: Date = new Date()): MockAlert[] {
  const base = { familyId: 'fam_monarca', recipientUserId: 'usr_monarca' }

  // Alerta da última toma de Amoxicilina de hoje que já chegou à hora (dose.due).
  const lastDue = AMOXICILLIN_TIMES.filter((time) => Date.parse(at(0, time, now)) <= now.getTime()).at(-1)
  const medicationAlert: MockAlert[] = lastDue
    ? [
        {
          ...base,
          id: 'alr_amox',
          memberId: 'mem_monarca',
          type: 'MEDICATION_DUE',
          sourceType: 'DOSE',
          sourceId: `dose_med_amox_${lastDue.replace(':', '')}`,
          triggerAt: at(0, lastDue, now),
        },
      ]
    : []

  return [
    ...medicationAlert,
    {
      ...base,
      id: 'alr_cardio',
      memberId: 'mem_monarca',
      type: 'APPOINTMENT_REMINDER',
      sourceType: 'APPOINTMENT',
      sourceId: 'apt_cardio',
      triggerAt: hoursFromNow(-2, now),
    },
    {
      ...base,
      id: 'alr_endocrino',
      memberId: 'mem_joao',
      type: 'APPOINTMENT_OUTCOME_REQUEST',
      sourceType: 'APPOINTMENT',
      sourceId: 'apt_endocrino',
      triggerAt: hoursFromNow(-20, now),
    },
    {
      ...base,
      id: 'alr_maria',
      memberId: 'mem_maria',
      type: 'EXAM_REMINDER',
      sourceType: 'EXAMINATION',
      sourceId: 'exm_maria',
      triggerAt: hoursFromNow(-72, now),
      readAt: hoursFromNow(-70, now),
    },
  ]
}
