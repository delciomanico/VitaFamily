import type { Clinic, ClinicSlot } from '@/types/clinic'
import { at } from '../time'

/** Clínicas fictícias. */
export const clinics: Clinic[] = [
  {
    id: 'cln_horizonte',
    type: 'PARTNER',
    name: 'Clínica Horizonte',
    status: 'ACTIVE',
    displayName: 'Clínica Horizonte',
    address: 'Rua da Missão 12, Luanda',
    phone: '+244 923 000 111',
    email: 'geral@clinicahorizonte.pt',
    openingHours: 'Seg a Sex 08:00–18:00 · Sáb 09:00–13:00',
    description: 'Consultas de especialidade e análises clínicas.',
  },
  { id: 'cln_vidaplena', type: 'PARTNER', name: 'Laboratório Vida Plena', status: 'ACTIVE' },
  { id: 'cln_bairro', type: 'PRIVATE', familyId: 'fam_monarca', name: 'Centro de Saúde do Bairro', status: 'ACTIVE' },
]

/* As contas do portal desta clínica vivem em `data/clinicAccounts.ts` (ADR-020): são
 * `ClinicAccount`, não `User` com um papel extra. */

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
  const appointmentSlots: ClinicSlot[] = Array.from({ length: SLOT_DAYS }, (_, days) => days).flatMap((days) =>
    HORIZONTE_SCHEDULE.flatMap(({ specialty, professionalName, times }) =>
      times
        .map((time) => ({
          id: slotId(days, time, specialty),
          clinicId: 'cln_horizonte',
          kind: 'APPOINTMENT' as const,
          capacity: 1,
          specialty,
          professionalName,
          startsAt: at(days, time, now),
          durationMinutes: 30,
        }))
        .filter((slot) => Date.parse(slot.startsAt) > now.getTime()),
    ),
  )
  return [...appointmentSlots, ...seedExamSlots(now)]
}

/** Horários de exame (D19, BR-APT-11): vários utilizadores partilham um horário até esgotar as vagas. */
const EXAM_SCHEDULE = [
  { clinicId: 'cln_horizonte', specialty: 'Análises clínicas', times: ['08:00', '09:00'], capacity: 4 },
  { clinicId: 'cln_horizonte', specialty: 'Ecografia', times: ['14:00', '15:00'], capacity: 1 },
  { clinicId: 'cln_vidaplena', specialty: 'Análises clínicas', times: ['08:30', '10:00'], capacity: 6 },
]

function seedExamSlots(now: Date): ClinicSlot[] {
  return Array.from({ length: SLOT_DAYS }, (_, days) => days).flatMap((days) =>
    EXAM_SCHEDULE.flatMap(({ clinicId, specialty, times, capacity }) =>
      times
        .map((time) => ({
          id: `${slotId(days, time, specialty)}_${clinicId.slice(4, 8)}_exam`,
          clinicId,
          kind: 'EXAM' as const,
          capacity,
          specialty,
          professionalName: undefined,
          startsAt: at(days, time, now),
          durationMinutes: 30,
        }))
        .filter((slot) => Date.parse(slot.startsAt) > now.getTime()),
    ),
  )
}
