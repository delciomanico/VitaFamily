import type {
  DataOrigin,
  MetricPoint,
  MetricRange,
  MetricReading,
  MetricType,
  SleepNight,
  WatchModel,
} from '@/types/wearable'

/**
 * Gerador determinístico de dados de relógio para a DEMONSTRAÇÃO.
 * Os mesmos (modelo, tipo, dia, hora) dão sempre o mesmo valor: os gráficos não mudam ao navegar.
 * Nada aqui é medição real nem interpretação clínica.
 */

export const metricLabels: Record<MetricType, string> = {
  HEART_RATE: 'Frequência cardíaca',
  STEPS: 'Passos',
  SLEEP: 'Sono',
  OXYGEN_SATURATION: 'Oxigénio no sangue (SpO₂)',
  BLOOD_PRESSURE: 'Pressão arterial',
  CALORIES: 'Calorias ativas',
}

export const metricSlugs: Record<MetricType, string> = {
  HEART_RATE: 'frequencia-cardiaca',
  STEPS: 'passos',
  SLEEP: 'sono',
  OXYGEN_SATURATION: 'spo2',
  BLOOD_PRESSURE: 'pressao-arterial',
  CALORIES: 'calorias',
}

export function metricFromSlug(slug: string | undefined): MetricType | undefined {
  return (Object.keys(metricSlugs) as MetricType[]).find((type) => metricSlugs[type] === slug)
}

export const originLabels: Record<DataOrigin, string> = {
  DEVICE_DIRECT: 'Medido pelo dispositivo',
  THIRD_PARTY_APP: 'Via app de terceiros',
  DERIVED: 'Estimado',
  MANUAL: 'Inserido manualmente',
}

/** Intervalos disponíveis por tipo: sono, SpO₂, tensão e calorias só têm sentido por dia/noite. */
export const metricRanges: Record<MetricType, MetricRange[]> = {
  HEART_RATE: ['DAY', 'WEEK', 'MONTH'],
  STEPS: ['DAY', 'WEEK', 'MONTH'],
  SLEEP: ['WEEK', 'MONTH'],
  OXYGEN_SATURATION: ['WEEK', 'MONTH'],
  BLOOD_PRESSURE: ['WEEK', 'MONTH'],
  CALORIES: ['WEEK', 'MONTH'],
}

/** Catálogo da demonstração: capacidades diferentes por marca, para mostrar que a UI se adapta. */
export const watchModels: WatchModel[] = [
  {
    id: 'samsung-galaxy-watch-6',
    manufacturer: 'Samsung',
    model: 'Galaxy Watch 6',
    sourceApp: 'Samsung Health',
    capabilities: ['HEART_RATE', 'STEPS', 'SLEEP', 'OXYGEN_SATURATION', 'BLOOD_PRESSURE', 'CALORIES'],
    origins: {
      HEART_RATE: 'DEVICE_DIRECT',
      STEPS: 'DEVICE_DIRECT',
      SLEEP: 'DEVICE_DIRECT',
      OXYGEN_SATURATION: 'DEVICE_DIRECT',
      BLOOD_PRESSURE: 'DEVICE_DIRECT',
      CALORIES: 'DERIVED',
    },
  },
  {
    id: 'garmin-venu-3',
    manufacturer: 'Garmin',
    model: 'Venu 3',
    sourceApp: 'Garmin Connect',
    capabilities: ['HEART_RATE', 'STEPS', 'SLEEP', 'OXYGEN_SATURATION', 'CALORIES'],
    origins: {
      HEART_RATE: 'DEVICE_DIRECT',
      STEPS: 'DEVICE_DIRECT',
      SLEEP: 'DEVICE_DIRECT',
      OXYGEN_SATURATION: 'DEVICE_DIRECT',
      CALORIES: 'DERIVED',
    },
  },
  {
    id: 'xiaomi-smart-band-8',
    manufacturer: 'Xiaomi',
    model: 'Smart Band 8',
    sourceApp: 'Zepp Life',
    capabilities: ['HEART_RATE', 'STEPS', 'SLEEP', 'CALORIES'],
    origins: {
      HEART_RATE: 'THIRD_PARTY_APP',
      STEPS: 'THIRD_PARTY_APP',
      SLEEP: 'THIRD_PARTY_APP',
      CALORIES: 'DERIVED',
    },
  },
]

export function findWatchModel(id: string): WatchModel | undefined {
  return watchModels.find((model) => model.id === id)
}

// --- Gerador pseudo-aleatório determinístico ---------------------------------------------------

function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32: devolve valores em [0, 1). */
function rng(seed: string): () => number {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min)

// --- Dados por dia/hora -------------------------------------------------------------------------

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

function startOfDay(date: Date, offsetDays = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays)
}

/** FC em repouso do dia (determinística). */
function restingRate(modelId: string, day: Date): number {
  return Math.round(between(rng(`${modelId}|rest|${dayKey(day)}`), 55, 67))
}

/** Há treino neste dia e a que hora? */
function workoutHour(modelId: string, day: Date): number | null {
  const random = rng(`${modelId}|workout|${dayKey(day)}`)
  return random() < 0.5 ? 17 + Math.floor(random() * 3) : null
}

export function heartRateAt(modelId: string, day: Date, hour: number): number {
  const rest = restingRate(modelId, day)
  const noise = between(rng(`${modelId}|hr|${dayKey(day)}|${hour}`), -3, 3)
  let offset = 2
  if (hour <= 5) offset = 0
  else if (hour <= 8) offset = 10
  else if (hour <= 17) offset = 15
  else if (hour <= 21) offset = 11
  if (workoutHour(modelId, day) === hour) offset = 55
  return Math.round(rest + offset + noise)
}

export function stepsAt(modelId: string, day: Date, hour: number): number {
  const random = rng(`${modelId}|steps|${dayKey(day)}|${hour}`)
  if (hour <= 5) return Math.round(between(random, 0, 20))
  if (hour <= 9) return Math.round(between(random, 350, 1200))
  if (hour <= 17) return Math.round(between(random, 200, 800))
  if (hour <= 20) return Math.round(between(random, 300, 1100))
  return Math.round(between(random, 0, 150))
}

function dailySteps(modelId: string, day: Date, untilHour = 23): number {
  let total = 0
  for (let hour = 0; hour <= untilHour; hour += 1) total += stepsAt(modelId, day, hour)
  return total
}

/** Noite que termina de manhã no `day`. */
export function sleepNight(modelId: string, day: Date): SleepNight {
  const random = rng(`${modelId}|sleep|${dayKey(day)}`)
  const totalMinutes = Math.round(between(random, 330, 500))
  const deep = Math.round(totalMinutes * between(random, 0.12, 0.2))
  const rem = Math.round(totalMinutes * between(random, 0.18, 0.25))
  const awake = Math.round(totalMinutes * between(random, 0.03, 0.08))
  return { totalMinutes, deep, rem, awake, light: totalMinutes - deep - rem - awake }
}

function spo2Night(modelId: string, day: Date): number {
  return Math.round(between(rng(`${modelId}|spo2|${dayKey(day)}`), 94, 99))
}

function pressureOf(modelId: string, day: Date): { systolic: number; diastolic: number } {
  const random = rng(`${modelId}|bp|${dayKey(day)}`)
  return { systolic: Math.round(between(random, 108, 128)), diastolic: Math.round(between(random, 68, 82)) }
}

function caloriesOf(modelId: string, day: Date, untilHour = 23): number {
  const random = rng(`${modelId}|kcal|${dayKey(day)}`)
  const full = Math.round(dailySteps(modelId, day) * 0.045 + 120 + between(random, 0, 60))
  return untilHour >= 23 ? full : Math.round((full * (untilHour + 1)) / 24)
}

// --- Leitura por intervalo ----------------------------------------------------------------------

const weekdayFormat = new Intl.DateTimeFormat('pt-PT', { weekday: 'short' })

const rangeDays = (range: MetricRange) => (range === 'WEEK' ? 7 : 30)
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
const round = (value: number) => Math.round(value)
const formatThousands = (value: number) => value.toLocaleString('pt-PT')

/** Dias do intervalo (do mais antigo ao mais recente), limitados ao instante da última sincronização. */
function daysOf(range: MetricRange, syncedUntil: Date): Date[] {
  const count = rangeDays(range)
  return Array.from({ length: count }, (_, i) => startOfDay(syncedUntil, i - (count - 1)))
}

function dayLabel(day: Date, range: MetricRange): string {
  return range === 'WEEK' ? weekdayFormat.format(day).replace('.', '') : String(day.getDate())
}

/**
 * Lê uma métrica como o plugin/API devolveriam: só até à última sincronização (`syncedUntil`).
 * Devolve `null` se o dispositivo não suporta o tipo.
 */
export function readMetric(
  model: WatchModel,
  type: MetricType,
  range: MetricRange,
  syncedUntil: Date,
): MetricReading | null {
  if (!model.capabilities.includes(type)) return null
  const origin = model.origins[type] ?? 'THIRD_PARTY_APP'
  const id = model.id
  const today = startOfDay(syncedUntil)
  const hourNow = syncedUntil.getHours()
  const base = { type, origin }

  if (type === 'HEART_RATE') {
    if (range === 'DAY') {
      const points: MetricPoint[] = Array.from({ length: hourNow + 1 }, (_, h) => ({
        label: `${h}h`,
        value: heartRateAt(id, today, h),
      }))
      const values = points.map((p) => p.value)
      return {
        ...base,
        range,
        kind: 'line',
        points,
        summary: {
          headline: String(round(average(values))),
          unit: 'bpm (média)',
          details: [
            { label: 'Mínima', value: `${Math.min(...values)} bpm` },
            { label: 'Máxima', value: `${Math.max(...values)} bpm` },
            { label: 'Em repouso', value: `${restingRate(id, today)} bpm` },
          ],
        },
      }
    }
    const days = daysOf(range, syncedUntil)
    const points = days.map((day) => {
      const upto = dayKey(day) === dayKey(today) ? hourNow : 23
      const values = Array.from({ length: upto + 1 }, (_, h) => heartRateAt(id, day, h))
      return { label: dayLabel(day, range), value: round(average(values)), min: Math.min(...values), max: Math.max(...values) }
    })
    return {
      ...base,
      range,
      kind: 'line',
      points,
      summary: {
        headline: String(round(average(points.map((p) => p.value)))),
        unit: 'bpm (média diária)',
        details: [
          { label: 'Mínima', value: `${Math.min(...points.map((p) => p.min ?? p.value))} bpm` },
          { label: 'Máxima', value: `${Math.max(...points.map((p) => p.max ?? p.value))} bpm` },
          { label: 'Em repouso (hoje)', value: `${restingRate(id, today)} bpm` },
        ],
      },
    }
  }

  if (type === 'STEPS') {
    if (range === 'DAY') {
      const points = Array.from({ length: hourNow + 1 }, (_, h) => ({ label: `${h}h`, value: stepsAt(id, today, h) }))
      const total = points.reduce((sum, p) => sum + p.value, 0)
      return {
        ...base,
        range,
        kind: 'bars',
        points,
        summary: {
          headline: formatThousands(total),
          unit: 'passos hoje',
          details: [{ label: 'Hora mais ativa', value: `${points.reduce((a, b) => (b.value > a.value ? b : a)).label}` }],
        },
      }
    }
    const days = daysOf(range, syncedUntil)
    const points = days.map((day) => ({
      label: dayLabel(day, range),
      value: dailySteps(id, day, dayKey(day) === dayKey(today) ? hourNow : 23),
    }))
    const values = points.map((p) => p.value)
    return {
      ...base,
      range,
      kind: 'bars',
      points,
      summary: {
        headline: formatThousands(round(average(values))),
        unit: 'passos (média diária)',
        details: [
          { label: 'Melhor dia', value: formatThousands(Math.max(...values)) },
          { label: 'Total', value: formatThousands(values.reduce((a, b) => a + b, 0)) },
        ],
      },
    }
  }

  if (type === 'SLEEP') {
    const days = daysOf(range, syncedUntil)
    const points = days.map((day) => ({
      label: dayLabel(day, range),
      value: Math.round((sleepNight(id, day).totalMinutes / 60) * 10) / 10,
    }))
    const values = points.map((p) => p.value)
    return {
      ...base,
      range,
      kind: 'bars',
      points,
      summary: {
        headline: average(values).toFixed(1).replace('.', ','),
        unit: 'horas por noite (média)',
        details: [
          { label: 'Noite mais longa', value: `${Math.max(...values).toFixed(1).replace('.', ',')} h` },
          { label: 'Noite mais curta', value: `${Math.min(...values).toFixed(1).replace('.', ',')} h` },
        ],
      },
    }
  }

  if (type === 'OXYGEN_SATURATION') {
    const days = daysOf(range, syncedUntil)
    const points = days.map((day) => ({ label: dayLabel(day, range), value: spo2Night(id, day) }))
    const values = points.map((p) => p.value)
    return {
      ...base,
      range,
      kind: 'line',
      points,
      summary: {
        headline: String(round(average(values))),
        unit: '% (média noturna)',
        details: [
          { label: 'Mínima', value: `${Math.min(...values)} %` },
          { label: 'Máxima', value: `${Math.max(...values)} %` },
        ],
      },
    }
  }

  if (type === 'BLOOD_PRESSURE') {
    const days = daysOf(range, syncedUntil)
    const readings = days.map((day) => ({ day, ...pressureOf(id, day) }))
    const points = readings.map((r) => ({ label: dayLabel(r.day, range), value: r.systolic, value2: r.diastolic }))
    const last = readings[readings.length - 1]
    return {
      ...base,
      range,
      kind: 'line',
      points,
      summary: {
        headline: last ? `${last.systolic}/${last.diastolic}` : '—',
        unit: 'mmHg (última leitura)',
        details: [
          { label: 'Sistólica (média)', value: `${round(average(readings.map((r) => r.systolic)))} mmHg` },
          { label: 'Diastólica (média)', value: `${round(average(readings.map((r) => r.diastolic)))} mmHg` },
        ],
      },
    }
  }

  // CALORIES
  const days = daysOf(range, syncedUntil)
  const points = days.map((day) => ({
    label: dayLabel(day, range),
    value: caloriesOf(id, day, dayKey(day) === dayKey(today) ? hourNow : 23),
  }))
  const values = points.map((p) => p.value)
  return {
    ...base,
    range,
    kind: 'bars',
    points,
    summary: {
      headline: formatThousands(round(average(values))),
      unit: 'kcal (média diária)',
      details: [
        { label: 'Hoje', value: `${formatThousands(values[values.length - 1] ?? 0)} kcal` },
        { label: 'Total', value: `${formatThousands(values.reduce((a, b) => a + b, 0))} kcal` },
      ],
    },
  }
}

/** Valor curto para o cartão da métrica no painel. */
export function todayValue(model: WatchModel, type: MetricType, syncedUntil: Date): string {
  const today = startOfDay(syncedUntil)
  const hour = syncedUntil.getHours()
  switch (type) {
    case 'HEART_RATE':
      return `${heartRateAt(model.id, today, hour)} bpm`
    case 'STEPS':
      return `${formatThousands(dailySteps(model.id, today, hour))} passos`
    case 'SLEEP': {
      const hours = sleepNight(model.id, today).totalMinutes / 60
      return `${hours.toFixed(1).replace('.', ',')} h`
    }
    case 'OXYGEN_SATURATION':
      return `${spo2Night(model.id, today)} %`
    case 'BLOOD_PRESSURE': {
      const { systolic, diastolic } = pressureOf(model.id, today)
      return `${systolic}/${diastolic} mmHg`
    }
    case 'CALORIES':
      return `${formatThousands(caloriesOf(model.id, today, hour))} kcal`
  }
}

/** Frequência cardíaca "ao vivo": varia a cada poucos segundos, em torno do valor da hora. */
export function liveHeartRate(model: WatchModel, at: Date): number {
  const base = heartRateAt(model.id, startOfDay(at), at.getHours())
  const wobble = Math.sin(at.getTime() / 4000) * 3 + between(rng(`${model.id}|live|${Math.floor(at.getTime() / 2000)}`), -2, 2)
  return Math.round(base + wobble)
}

/** Nº de amostras horárias "novas" entre duas sincronizações, por tipo suportado (para o resultado de sync). */
export function countNewSamples(grantedTypes: MetricType[], from: Date, to: Date): number {
  const hours = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 3600000))
  return grantedTypes.length * Math.max(hours, 1) * 4
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours} h ${String(minutes).padStart(2, '0')} min`
}
