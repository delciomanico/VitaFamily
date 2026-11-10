import { seedAppointments } from './data/appointments'
import { clinicAccounts } from './data/clinicAccounts'
import { clinics, seedSlots } from './data/clinics'
import { seedExamDocuments, seedExamResults, seedExaminations } from './data/examinations'
import { families, guardianships, invitations, members, sharingGrants } from './data/families'
import {
  seedClinicConsents,
  seedClinicPatients,
  seedClinicVisits,
  type MockClinicConsent,
  type MockClinicLinkCode,
  type MockClinicPatient,
  type MockClinicVisit,
} from './data/clinicPatients'
import { seedProfessionals, seedScheduleRules, seedServices } from './data/clinicCatalog'
import { allergies, conditions } from './data/health'
import { seedDocuments, seedDoses, seedMedicationPlans, seedPrescriptions } from './data/medications'
import { insuranceAccounts, insurers } from './data/insurers'
import { users } from './data/users'
import type { InsurancePolicy, ReimbursementClaim } from '@/types/insurance'
import type { Recommendation } from '@/types/recommendation'
import type { DataExport, NotificationPreferences } from '@/types/settings'
import { scanAlerts, type MockAlert } from './alertRules'
import { generateRules } from './clinicSchedule'
import type { ClinicExamOrder } from '@/types/examOrder'
import type { ClinicExamResultsDraft, ConsultationReport } from '@/types/clinicReport'
import type { ClinicAuditEntry, ClinicReceipt } from '@/types/clinicReceipt'
import type { ClinicProfessional, ClinicScheduleRule, ClinicServiceType, ClinicTimeOff } from '@/types/clinic'

/** Recibo no mock: `clinicId` e a ligação ao paciente (`clinic_receipt_links`, BR-CLN-35) nunca saem. */
export interface MockClinicReceipt extends ClinicReceipt {
  clinicId: string
  link: { familyId: string; memberId: string } | null
}

/** Entrada de auditoria da clínica (`audit_logs.actor_clinic_id`, BR-CLN-40): sem PII por construção. */
export interface MockClinicAuditEntry extends ClinicAuditEntry {
  clinicId: string
}

/** Relatório da consulta no mock (M15 S): `clinicId` e a ligação ao paciente nunca saem (BR-CLN-50: sem FK). */
export interface MockConsultationReport extends ConsultationReport {
  clinicId: string
  /** Família/membro Vita da consulta (só `APPOINTMENT`); a visita manual não tem. */
  familyId?: string
  memberId?: string
  /** Conta autora (`author_account_id`, nulo se removida). */
  authorAccountId?: string
  /** Retrato do perfil da clínica fixado ao finalizar (nome). */
  clinicName?: string
}

/** Rascunho de resultados de exame no mock (M15 T): tabela própria, o paciente nunca o vê. */
export interface MockExamResultsDraft extends ClinicExamResultsDraft {
  clinicId: string
}

/**
 * Pedido de exame no mock (M15 U): registo da clínica, sem FK para consultas (BR-CLN-56). `link` é a
 * ponte para ids Vita (`clinic_exam_order_links`, só no servidor); `examinationId`/`bookedHere` o
 * exame ligado. O estado visível deriva-se do exame ligado (cumprido/cancelado/apagado).
 */
export interface MockExamOrder extends Omit<ClinicExamOrder, 'status'> {
  clinicId: string
  cancelled: boolean
  link?: { familyId: string; memberId: string; appointmentId: string }
  examinationId?: string
  /** O exame ligado é da própria clínica do pedido (BR-CLN-52). */
  bookedHere?: boolean
}

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
      insurers,
      insuranceAccounts,
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
    /** Recomendações escritas pelas clínicas (BR-CLN-09); `clinicName` congelado. */
    recommendations: [] as Array<Recommendation & { familyId: string; clinicId: string }>,
    /** Apólices dos membros (BR-INS-01); `familyId` só no mock, o contrato não o devolve. */
    insurancePolicies: [] as Array<InsurancePolicy & { familyId: string }>,
    /** Pedidos de reembolso (BR-INS-03); `insurerId` congelado na submissão, `decidedAt` só no mock. */
    reimbursementClaims: [] as Array<
      ReimbursementClaim & { familyId: string; memberId: string; insurerId: string; receiptIds?: string[] }
    >,
    /** Recibos das clínicas (M14 R, BR-CLN-31..35). */
    clinicReceipts: [] as MockClinicReceipt[],
    /** Contador sequencial por clínica (BR-CLN-32): último número atribuído. */
    clinicReceiptCounters: {} as Record<string, number>,
    /** Relatórios da consulta (M15 S, BR-CLN-41): no máximo um por marcação. */
    consultationReports: [] as MockConsultationReport[],
    /** Pedidos de exame da clínica (M15 U, BR-CLN-51..56). */
    examOrders: [] as MockExamOrder[],
    /** Rascunhos de resultados de exame (M15 T, BR-CLN-47). */
    examResultDrafts: [] as MockExamResultsDraft[],
    /** Laudos gerados (instantâneo do que foi emitido, BR-CLN-49): linhas do PDF por exame. */
    examReportSnapshots: [] as Array<{ examinationId: string; documentId: string; lines: string[] }>,
    /** Auditoria das contas do portal (BR-CLN-40). */
    clinicAudit: [] as MockClinicAuditEntry[],
    /** Catálogo da clínica (M14, BR-CLN-11); `clinicId` só no mock (o contrato usa a clínica da sessão). */
    professionals: structuredClone(seedProfessionals) as Array<ClinicProfessional & { clinicId: string }>,
    services: structuredClone(seedServices) as Array<ClinicServiceType & { clinicId: string }>,
    scheduleRules: structuredClone(seedScheduleRules) as Array<ClinicScheduleRule & { clinicId: string }>,
    timeOffs: [] as Array<ClinicTimeOff & { clinicId: string }>,
    /** Pacientes da clínica (M14 P, BR-CLN-17); `memberId`/`linkVia` só no mock, nunca saem. */
    clinicPatients: seedClinicPatients(now) as MockClinicPatient[],
    /** Consentimento por membro e clínica (BR-CLN-19). */
    clinicConsents: seedClinicConsents(now) as MockClinicConsent[],
    /** Códigos de ligação gerados pelo titular (BR-CLN-20): guarda-se o normalizado. */
    clinicLinkCodes: [] as MockClinicLinkCode[],
    /** Visitas presenciais só da clínica (BR-CLN-18 c). */
    clinicVisits: seedClinicVisits(now) as MockClinicVisit[],
    alerts: [] as MockAlert[],
    /** Só quem alterou as preferências; os restantes usam DEFAULT_NOTIFICATION_PREFERENCES. */
    notificationPreferences: [] as MockNotificationPreferences[],
    exports: [] as MockExport[],
    skippedAlertKeys: [] as string[],
  }
  // Horários gerados pelas regras demo (janela de 8 semanas, BR-CLN-12).
  generateRules(data, data.scheduleRules, now)
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
