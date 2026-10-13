import { seedAppointments } from './data/appointments'
import { clinicAccounts } from './data/clinicAccounts'
import { clinics, seedSlots } from './data/clinics'
import { seedExamDocuments, seedExamResults, seedExaminations } from './data/examinations'
import { families, guardianships, invitations, members, sharingGrants } from './data/families'
import { allergies, conditions } from './data/health'
import { seedDocuments, seedDoses, seedMedicationPlans, seedPrescriptions } from './data/medications'
import { users } from './data/users'
import type { DataExport, NotificationPreferences } from '@/types/settings'
import { scanAlerts, type MockAlert } from './alertRules'

export interface MockNotificationPreferences extends NotificationPreferences {
  userId: string
}

export interface MockExport extends DataExport {
  userId: string
}

/**
 * “Base de dados” em memória do backend simulado.
 * Começa com os dados demo (datas relativas a agora) e perde as alterações ao recarregar.
 */
function seed(now: Date = new Date()) {
  const medicationPlans = seedMedicationPlans(now)
  const data = {
    ...structuredClone({
      users,
      families,
      members,
      guardianships,
      invitations,
      allergies,
      conditions,
      clinics,
      clinicAccounts,
      sharingGrants,
    }),
    /** Resultado da consulta escrito pela clínica (BR-CLN-06). O contrato nunca o devolve
     * (`outcomeNote` só existe no pedido de `completeClinicAppointment`), por isso fica fora
     * de `Appointment` — a família vê a consulta REALIZADA e a receita, não esta nota. */
    appointmentOutcomes: [] as Array<{ appointmentId: string; outcomeNote: string; recordedAt: string }>,
    slots: seedSlots(now),
    appointments: seedAppointments(now),
    prescriptions: seedPrescriptions(now),
    medicationPlans,
    doses: seedDoses(medicationPlans, now),
    documents: [...seedDocuments(now), ...seedExamDocuments(now)],
    examinations: seedExaminations(now),
    examResults: seedExamResults(now),
    alerts: [] as MockAlert[],
    /** Só quem alterou as preferências; os restantes usam DEFAULT_NOTIFICATION_PREFERENCES. */
    notificationPreferences: [] as MockNotificationPreferences[],
    exports: [] as MockExport[],
    skippedAlertKeys: [] as string[],
  }
  // Alertas já disparados pelas regras; os das tomas já tomadas ficam lidos (demo).
  for (const alert of scanAlerts(data, now)) {
    const dose = data.doses.find((d) => d.id === alert.sourceId)
    if (dose?.status === 'TAKEN') alert.readAt = dose.actedAt
  }
  return data
}

export let db = seed()

/** Repõe os dados demo (usado nos testes, opcionalmente num instante fixo). */
export function resetDb(now?: Date) {
  db = seed(now)
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
