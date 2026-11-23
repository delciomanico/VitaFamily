import type { AdherenceItem } from './report'

/*
 * Resumo de saúde (M17; openapi → HealthSummary / FamilyHealthSummary, BR-RPT-11..18).
 * Calculado pelo servidor, sem IA e sem interpretação clínica: o cliente só apresenta.
 * Cada secção é omitida (undefined) quando o utilizador não pode ver a categoria.
 */

export interface HealthSummaryPeriod {
  from: string
  to: string
}

export interface AdherenceBucket {
  /** Início da semana (período ≤ 90 dias) ou do mês. */
  periodStart: string
  taken: number
  notTaken: number
  unconfirmed: number
  /** `null` quando não há tomas a contar (nunca 0 %). */
  adherencePct: number | null
}

export interface MedicationAdherenceStat extends AdherenceItem {
  adherencePct: number | null
}

export interface ExamParameterSeries {
  parameter: string
  unit: string
  count: number
  min: number
  max: number
  first: number
  last: number
  variationAbs?: number | null
  variationPct?: number | null
  referenceMin?: number | null
  referenceMax?: number | null
  referenceText?: string | null
  points: Array<{ date: string; value: number }>
  truncated?: boolean
}

export interface CountByMonth {
  /** `aaaa-mm`. */
  month: string
  count: number
}

export type MissingRecordCode =
  | 'BLOOD_TYPE_UNSET'
  | 'APPOINTMENT_PAST_OPEN'
  | 'EXAM_PAST_OPEN'
  | 'EXAM_WITHOUT_RESULTS'
  | 'PRESCRIPTION_WITHOUT_DOCUMENT'
  | 'PLAN_WITHOUT_SCHEDULE'
  | 'DOSES_UNCONFIRMED'

export interface MissingRecordItem {
  code: MissingRecordCode
  count: number
  /** Só para quem pode escrever na categoria. */
  sourceIds?: string[]
}

export interface HealthSummary {
  memberId: string
  period: HealthSummaryPeriod
  generatedAt: string
  medication?: {
    overall: AdherenceBucket
    byMedication: MedicationAdherenceStat[]
    granularity: 'WEEK' | 'MONTH'
    series: AdherenceBucket[]
  }
  prescriptions?: { active: number; endingSoon: number; closedInPeriod: number }
  exams?: {
    byStatus: Record<string, number>
    byMonth: CountByMonth[]
    upcoming30d: number
    series: ExamParameterSeries[]
    truncated: boolean
  }
  appointments?: { byStatus: Record<string, number>; byMonth: CountByMonth[]; upcoming30d: number }
  alerts?: { total: number; unread: number; byType: Record<string, number> }
  missing?: MissingRecordItem[]
}

export interface FamilyHealthSummaryMember {
  memberId: string
  displayName: string
  adherencePct?: number | null
  activeMedications?: number
  upcoming30d?: number
  missingCount?: number
  activity?: {
    prescriptions?: number
    appointments?: number
    exams?: number
    dosesConfirmed?: number
    lastActivityOn?: string | null
  }
}

export interface FamilyHealthSummary {
  period: HealthSummaryPeriod
  generatedAt: string
  members: FamilyHealthSummaryMember[]
}
