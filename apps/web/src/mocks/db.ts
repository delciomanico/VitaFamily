import { seedAlerts } from './data/alerts'
import { seedAppointments } from './data/appointments'
import { clinicStaff, clinics, seedSlots } from './data/clinics'
import { seedExamDocuments, seedExamResults, seedExaminations } from './data/examinations'
import { families, guardianships, invitations, members, sharingGrants } from './data/families'
import { allergies, conditions } from './data/health'
import { seedDocuments, seedDoses, seedMedicationPlans, seedPrescriptions } from './data/medications'
import { users } from './data/users'

/**
 * “Base de dados” em memória do backend simulado.
 * Começa com os dados demo (datas relativas a agora) e perde as alterações ao recarregar.
 */
function seed(now: Date = new Date()) {
  const medicationPlans = seedMedicationPlans(now)
  return {
    ...structuredClone({
      users,
      families,
      members,
      guardianships,
      invitations,
      allergies,
      conditions,
      clinics,
      clinicStaff,
      sharingGrants,
    }),
    slots: seedSlots(now),
    appointments: seedAppointments(now),
    prescriptions: seedPrescriptions(now),
    medicationPlans,
    doses: seedDoses(medicationPlans, now),
    documents: [...seedDocuments(now), ...seedExamDocuments(now)],
    examinations: seedExaminations(now),
    examResults: seedExamResults(now),
    alerts: seedAlerts(now),
  }
}

export let db = seed()

/** Repõe os dados demo (usado nos testes, opcionalmente num instante fixo). */
export function resetDb(now?: Date) {
  db = seed(now)
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
