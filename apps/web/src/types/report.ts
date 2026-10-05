import type { Appointment, AppointmentItem } from './appointment'
import type { AlertItem } from './alert'
import type { ExaminationSummary } from './examination'
import type { Family, PublicMember } from './family'
import type { BloodType, MedicalCondition } from './health'
import type { DoseStatus, MedicationSummary } from './medication'
import type { PrescriptionSummary } from './prescription'
import type { SharingCategory } from './sharing'

/** Itens pendentes de um membro (UC-RPT-02; openapi → PendingItem). */
export type PendingItemType = 'UNCONFIRMED_DOSE' | 'APPOINTMENT_OUTCOME' | 'EXAM_OUTCOME'

export interface PendingItem {
  type: PendingItemType
  memberId: string
  sourceId: string
  /** Quando era a toma, a consulta ou o exame. */
  date: string
  /** Resumo da origem (medicamento, especialidade ou exame), para mostrar. */
  label: string
  /** Recurso a abrir: plano do medicamento, consulta ou exame. */
  targetId: string
}

/** Toma de hoje, pronta a mostrar na Home. */
export interface TodayDose {
  id: string
  scheduledAt: string
  status: DoseStatus
  /** Ex.: “Amoxicilina 500 mg”. */
  medication: string
  memberName: string
  isSelf: boolean
}

/** Resumo para a Home. */
export interface HomeSummary {
  nextAppointment: { appointment: Appointment; memberName: string; isSelf: boolean } | null
  today: {
    /** Tomas de hoje ainda por confirmar. */
    pendingDoses: number
    /** Resultados de exame registados recentemente. */
    newResults: number
    members: number
  }
  family: {
    /** Membros visíveis ao utilizador. */
    tracked: number
    /** Membros com pelo menos um item pendente. */
    withPending: number
  }
  /** Alertas recentes (lidos e por ler), mais recentes primeiro. */
  recentAlerts: AlertItem[]
  /** Tomas de hoje dos membros visíveis, por hora. */
  todayDoses: TodayDose[]
}

/** Tomas de um medicamento no período, por estado: só números, sem juízo clínico (UC-RPT-03). */
export interface AdherenceItem {
  planId: string
  medicationName: string
  taken: number
  notTaken: number
  unconfirmed: number
  pending: number
}

/*
 * Relatórios (UC-RPT-01/02, BR-RPT-01): cada secção só existe se o utilizador a puder ver;
 * sem permissão, a secção é omitida (undefined), sem indicar se há dados.
 */

/** Um membro na visão familiar (openapi → FamilyReportMember). */
export interface FamilyReportMember {
  member: PublicMember
  isSelf: boolean
  /** Próprio ou dependente seu. */
  manage: boolean
  /** Categorias que o utilizador pode ver deste membro. */
  categories: SharingCategory[]
  allergies?: string[]
  conditions?: string[]
  activeMedications?: MedicationSummary[]
  upcomingAppointments?: AppointmentItem[]
  upcomingExaminations?: ExaminationSummary[]
  /** Pendentes nas categorias visíveis. */
  pending: PendingItem[]
}

/** Visão familiar (UC-RPT-02). */
export interface FamilyReport {
  generatedAt: string
  family: Family
  /** Membros ativos da família (dado C1, visível a todos). */
  familySize: number
  /** Só os membros com alguma informação visível ao utilizador. */
  members: FamilyReportMember[]
}

/** Período do relatório individual (BR-RPT-02: 12 meses por defeito, máximo 5 anos). */
export interface ReportPeriod {
  from: string
  to: string
}

/** Relatório individual (UC-RPT-01; openapi → MemberReport). */
export interface MemberReport extends ReportPeriod {
  generatedAt: string
  member: PublicMember
  isSelf: boolean
  manage: boolean
  categories: SharingCategory[]
  bloodType?: BloodType
  allergies?: string[]
  conditions?: MedicalCondition[]
  prescriptions?: PrescriptionSummary[]
  medications?: MedicationSummary[]
  adherence?: AdherenceItem[]
  /** Consultas do período e as próximas. */
  appointments?: AppointmentItem[]
  examinations?: ExaminationSummary[]
  pending: PendingItem[]
}

/** Membro que se pode escolher no relatório individual. */
export interface ReportSubject {
  member: PublicMember
  isSelf: boolean
}
