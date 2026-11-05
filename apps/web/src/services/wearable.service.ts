import {
  countNewSamples,
  findWatchModel,
  liveHeartRate,
  readMetric,
  sleepNight,
  todayValue,
  watchModels,
} from '@/lib/wearableSimulator'
import type {
  ConnectedWatch,
  MetricRange,
  MetricReading,
  MetricType,
  SleepNight,
  SyncResult,
  WatchModel,
  WatchProblem,
} from '@/types/wearable'

/**
 * Serviço da zona "Relógio" — **simulado** para demonstração (sem relógio, Health Connect nem API).
 * Na versão real este ficheiro passa a chamar o plugin Capacitor e a API `wearables`
 * (docs/wearables/03-proposed-architecture.md); a interface das páginas mantém-se.
 *
 * Persistência: só o estado da ligação simulada (modelo, tipos autorizados, datas) em sessionStorage,
 * para sobreviver a um refresh durante a apresentação. Não guarda nenhuma medição.
 */

const KEY = 'vf.wearable.demo'
const DELAY_MS = 700

const wait = (ms = DELAY_MS) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function load(): ConnectedWatch | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ConnectedWatch) : null
  } catch {
    return null
  }
}

let connection: ConnectedWatch | null = load()

function save(next: ConnectedWatch | null) {
  connection = next
  try {
    if (next) window.sessionStorage.setItem(KEY, JSON.stringify(next))
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // Sem sessionStorage: a demonstração continua em memória.
  }
}

export interface WatchStatus {
  connection: ConnectedWatch
  model: WatchModel
}

function statusOf(current: ConnectedWatch | null): WatchStatus | null {
  const model = current ? findWatchModel(current.modelId) : undefined
  return current && model ? { connection: current, model } : null
}

/** Texto "há 5 min" para a última sincronização. */
export function formatSyncAge(iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `há ${hours} h` : `há ${Math.round(hours / 24)} d`
}

export const wearableService = {
  async getStatus(): Promise<WatchStatus | null> {
    await wait(300)
    return statusOf(connection)
  },

  /** Procura fontes de dados compatíveis (relógios cujas apps escrevem no Health Connect). */
  async discover(): Promise<WatchModel[]> {
    await wait(1600)
    return watchModels
  },

  async connect(modelId: string, grantedTypes: MetricType[]): Promise<WatchStatus> {
    await wait(900)
    const model = findWatchModel(modelId)
    if (!model) throw new Error('Relógio desconhecido.')
    const now = new Date().toISOString()
    const next: ConnectedWatch = {
      modelId,
      connectedAt: now,
      lastSyncAt: now,
      grantedTypes: grantedTypes.filter((type) => model.capabilities.includes(type)),
      problem: null,
    }
    save(next)
    return { connection: next, model }
  },

  /** Sincroniza: avança `lastSyncAt` e devolve o resumo (aceites vs duplicados, como a ingestão idempotente). */
  async sync(): Promise<SyncResult> {
    await wait(1400)
    const current = connection
    if (!current) throw new Error('Nenhum relógio ligado.')
    const now = new Date()
    const accepted = countNewSamples(current.grantedTypes, new Date(current.lastSyncAt), now)
    const note = current.problem === 'SOURCE_STALE' ? 'Relógio sincronizado novamente com a app do fabricante.' : undefined
    save({ ...current, lastSyncAt: now.toISOString(), problem: current.problem === 'PERMISSION_REVOKED' ? current.problem : null })
    return { accepted, duplicates: Math.round(accepted * 0.12), note }
  },

  async setGrantedTypes(types: MetricType[]): Promise<WatchStatus> {
    await wait(400)
    const status = statusOf(connection)
    if (!status) throw new Error('Nenhum relógio ligado.')
    const next: ConnectedWatch = {
      ...status.connection,
      grantedTypes: types.filter((type) => status.model.capabilities.includes(type)),
      problem: status.connection.problem === 'PERMISSION_REVOKED' ? null : status.connection.problem,
    }
    save(next)
    return { connection: next, model: status.model }
  },

  async disconnect(): Promise<void> {
    await wait(600)
    save(null)
  },

  async getMetric(type: MetricType, range: MetricRange): Promise<MetricReading | null> {
    await wait(350)
    const status = statusOf(connection)
    if (!status || !status.connection.grantedTypes.includes(type)) return null
    return readMetric(status.model, type, range, new Date(status.connection.lastSyncAt))
  },

  async getSleepNight(): Promise<SleepNight | null> {
    await wait(200)
    const status = statusOf(connection)
    if (!status || !status.connection.grantedTypes.includes('SLEEP')) return null
    return sleepNight(status.model.id, new Date(status.connection.lastSyncAt))
  },

  /** Valores de hoje para os cartões do painel (síncrono: só cálculo). */
  todayValues(status: WatchStatus): Partial<Record<MetricType, string>> {
    const at = new Date(status.connection.lastSyncAt)
    return Object.fromEntries(status.connection.grantedTypes.map((type) => [type, todayValue(status.model, type, at)]))
  },

  liveHeartRate(model: WatchModel): number {
    return liveHeartRate(model, new Date())
  },

  /** Controlo de demonstração: provoca/limpa um problema de ligação. */
  async simulateProblem(problem: WatchProblem | null): Promise<WatchStatus | null> {
    await wait(200)
    const status = statusOf(connection)
    if (!status) return null
    const next = { ...status.connection, problem }
    save(next)
    return { connection: next, model: status.model }
  },
}
