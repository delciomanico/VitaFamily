import type { ClinicPatient } from '@/types/clinic'

/** Texto curto do estado da partilha de um paciente da clínica (BR-CLN-19). */
export function sharingLabel(patient: ClinicPatient): { label: string; tone: 'neutral' | 'primary' | 'success' } {
  const link = patient.vitaLink
  if (!link) return { label: 'Sem conta Vita', tone: 'neutral' }
  return link.consentLevel === 'HISTORY'
    ? { label: 'Partilha o histórico', tone: 'success' }
    : { label: 'Vita · só marcações', tone: 'primary' }
}

/** Contacto numa linha (telefone · e-mail). */
export const contactLine = (patient: ClinicPatient) =>
  [patient.phone, patient.email].filter(Boolean).join(' · ') || 'Sem contacto'
