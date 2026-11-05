/**
 * Zona "Relógio" (DEMONSTRAÇÃO): tipos do módulo simulado.
 * Os dados do relógio são independentes dos dados de saúde da app (docs/wearables/04-data-model.md).
 */

export type MetricType = 'HEART_RATE' | 'STEPS' | 'SLEEP' | 'OXYGEN_SATURATION' | 'BLOOD_PRESSURE' | 'CALORIES'

/** Origem do dado (docs/wearables/04-data-model.md §2). */
export type DataOrigin = 'DEVICE_DIRECT' | 'THIRD_PARTY_APP' | 'DERIVED' | 'MANUAL'

export type MetricRange = 'DAY' | 'WEEK' | 'MONTH'

export interface WatchModel {
  id: string
  manufacturer: string
  model: string
  /** App do fabricante que escreve no Health Connect (`dataOrigin`). */
  sourceApp: string
  /** Só o que o dispositivo realmente fornece: a UI nunca mostra o resto. */
  capabilities: MetricType[]
  origins: Partial<Record<MetricType, DataOrigin>>
}

export type WatchProblem = 'PERMISSION_REVOKED' | 'SOURCE_STALE'

export interface ConnectedWatch {
  modelId: string
  connectedAt: string
  lastSyncAt: string
  /** Tipos que o utilizador autorizou (subconjunto das capacidades). */
  grantedTypes: MetricType[]
  problem: WatchProblem | null
}

export interface MetricPoint {
  label: string
  value: number
  /** Segunda série (ex.: diastólica) ou mínimo do intervalo. */
  value2?: number
  min?: number
  max?: number
}

export interface MetricSummary {
  headline: string
  unit: string
  details: Array<{ label: string; value: string }>
}

export interface MetricReading {
  type: MetricType
  range: MetricRange
  points: MetricPoint[]
  summary: MetricSummary
  origin: DataOrigin
  kind: 'line' | 'bars'
}

export interface SleepNight {
  totalMinutes: number
  deep: number
  light: number
  rem: number
  awake: number
}

export interface SyncResult {
  accepted: number
  duplicates: number
  note?: string
}
