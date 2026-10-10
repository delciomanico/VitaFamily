import type { Clinic, ClinicSlot } from '@/types/clinic'
import { at } from '../time'

/** Clínicas fictícias. */
export const clinics: Clinic[] = [
  { id: 'cln_horizonte', type: 'PARTNER', name: 'Clínica Horizonte', status: 'ACTIVE' },
  { id: 'cln_vidaplena', type: 'PARTNER', name: 'Laboratório Vida Plena', status: 'ACTIVE' },
  { id: 'cln_bairro', type: 'PRIVATE', familyId: 'fam_monarca', name: 'Centro de Saúde do Bairro', status: 'ACTIVE' },
]

/** Gestor da clínica parceira (D17): liga uma conta a uma clínica, sem família. */
export interface MockClinicStaff {
  clinicId: string
  userId: string
  role: 'CLINIC_MANAGER'
}

export const clinicStaff: MockClinicStaff[] = [
  { clinicId: 'cln_horizonte', userId: 'usr_clinica', role: 'CLINIC_MANAGER' },
]

/** Agenda-tipo da Clínica Horizonte: especialidade, profissional e horas de cada dia. */
const HORIZONTE_SCHEDULE = [
  {
    specialty: 'Cardiologia',
    professionalName: 'Dr.ª Ana Costa',
    times: ['09:00', '09:30', '10:00', '10:30', '11:00'],
  },
  { specialty: 'Dermatologia', professionalName: 'Dr.ª Inês Lima', times: ['10:00', '11:00', '12:00'] },
  { specialty: 'Pediatria', professionalName: 'Dr. Rui Mendes', times: ['14:00', '14:30', '15:00', '15:30', '16:00'] },
  { specialty: 'Medicina geral', professionalName: 'Dr. Carlos Pinto', times: ['08:30', '09:30', '16:30', '17:30'] },
]

/** Dias publicados pela clínica na demo. */
export const SLOT_DAYS = 21

export const slotId = (days: number, time: string, specialty: string) =>
  `slot_${days}_${time.replace(':', '')}_${specialty.slice(0, 4).toLowerCase()}`

/** Horários da Clínica Horizonte nos próximos dias (só os futuros). */
export function seedSlots(now: Date = new Date()): ClinicSlot[] {
  return Array.from({ length: SLOT_DAYS }, (_, days) => days).flatMap((days) =>
    HORIZONTE_SCHEDULE.flatMap(({ specialty, professionalName, times }) =>
      times
        .map((time) => ({
          id: slotId(days, time, specialty),
          clinicId: 'cln_horizonte',
          specialty,
          professionalName,
          startsAt: at(days, time, now),
          durationMinutes: 30,
        }))
        .filter((slot) => Date.parse(slot.startsAt) > now.getTime()),
    ),
  )
}
