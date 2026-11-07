import type { ClinicPatient, ClinicVisit, ConsentLevel } from '@/types/clinic'
import { HISTORY_CONSENT_MONTHS } from '@/types/clinicConsent'
import { at } from '../time'

/*
 * Pacientes da clínica e consentimentos demo (M14 P, BR-CLN-17..21). Fictícios.
 * `memberId` só existe no mock (na API real a ligação vive em `clinic_patient_links` e nunca sai).
 */

export interface MockClinicPatient extends ClinicPatient {
  clinicId: string
  /** Membro Vita ligado (nunca exposto); ausente = sem ligação. */
  memberId?: string
  linkVia?: 'EMAIL' | 'CODE'
}

export interface MockClinicConsent {
  memberId: string
  clinicId: string
  level: ConsentLevel
  /** Só em HISTORY. */
  validUntil?: string
}

export interface MockClinicLinkCode {
  memberId: string
  /** Normalizado: maiúsculas, sem hífen. */
  code: string
  createdAt: string
  expiresAt: string
  used: boolean
}

export type MockClinicVisit = ClinicVisit & { clinicId: string }

export function addMonths(iso: string, months: number): string {
  const date = new Date(iso)
  date.setMonth(date.getMonth() + months)
  return date.toISOString()
}

export function seedClinicPatients(now: Date = new Date()): MockClinicPatient[] {
  const created = at(-60, '10:00', now)
  const base = { clinicId: 'cln_horizonte', createdAt: created, updatedAt: created }
  return [
    {
      ...base,
      id: 'cpt_monarca',
      name: 'Monarca Lopes',
      phone: '+244 923 000 111',
      email: 'demo@vitafamily.app',
      birthDate: '1985-03-12',
      notes: 'Prefere marcações de manhã.',
      origin: 'VITA',
      vitaLink: { via: 'EMAIL', consentLevel: 'HISTORY', consentValidUntil: addMonths(now.toISOString(), HISTORY_CONSENT_MONTHS) },
      memberId: 'mem_monarca',
      linkVia: 'EMAIL',
    },
    {
      ...base,
      id: 'cpt_helena',
      name: 'Helena Baptista',
      phone: '+244 924 555 010',
      email: null,
      birthDate: '1971-08-30',
      notes: 'Cliente de balcão. Alérgica a penicilina (informação dada por ela).',
      origin: 'MANUAL',
      vitaLink: null,
    },
    {
      ...base,
      id: 'cpt_carlos',
      name: 'Carlos Mateus',
      phone: null,
      email: 'carlos.mateus@exemplo.ao',
      birthDate: null,
      notes: null,
      origin: 'MANUAL',
      vitaLink: null,
    },
    {
      ...base,
      id: 'cpt_pedro',
      name: 'Pedro L.',
      phone: null,
      email: null,
      birthDate: '2017-02-14',
      notes: null,
      origin: 'VITA',
      vitaLink: { via: 'CODE', consentLevel: 'BOOKINGS', consentValidUntil: null },
      memberId: 'mem_pedro',
      linkVia: 'CODE',
    },
    // Outra clínica: serve para verificar o isolamento.
    {
      id: 'cpt_vp_luisa',
      clinicId: 'cln_vidaplena',
      name: 'Luísa Fonseca',
      phone: '+244 922 111 222',
      email: null,
      birthDate: null,
      notes: null,
      origin: 'MANUAL',
      vitaLink: null,
      createdAt: created,
      updatedAt: created,
    },
  ]
}

/** `vitaLink` é sempre derivado do consentimento atual (não se guarda duplicado). */
export function seedClinicConsents(now: Date = new Date()): MockClinicConsent[] {
  return [
    {
      memberId: 'mem_monarca',
      clinicId: 'cln_horizonte',
      level: 'HISTORY',
      validUntil: addMonths(now.toISOString(), HISTORY_CONSENT_MONTHS),
    },
    { memberId: 'mem_pedro', clinicId: 'cln_horizonte', level: 'BOOKINGS' },
  ]
}

export function seedClinicVisits(now: Date = new Date()): MockClinicVisit[] {
  return [
    {
      id: 'vis_helena_passada',
      clinicId: 'cln_horizonte',
      clinicPatientId: 'cpt_helena',
      scheduledAt: at(-14, '11:00', now),
      durationMinutes: 30,
      specialty: 'Medicina geral',
      status: 'COMPLETED',
      outcomeNote: 'Tensão arterial controlada. Voltar em 3 meses.',
    },
  ]
}
