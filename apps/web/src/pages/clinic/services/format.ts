import type { ScheduleGeneration as ClinicScheduleGenerationLike } from '@/types/clinic'

/** Preço em cêntimos → texto com a moeda da clínica (ex.: “15 000,00 Kz”). */
export function formatPrice(priceMinor: number | undefined, currency: string): string {
  if (priceMinor === undefined) return 'Sem preço'
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(priceMinor / 100)
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currency}`
  }
}

/** Texto digitado (“15000”, “15 000,50”) → cêntimos; vazio → undefined; inválido → null. */
export function parsePriceInput(text: string): number | undefined | null {
  const clean = text.trim().replace(/\s/g, '').replace(',', '.')
  if (clean === '') return undefined
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const minor = Math.round(Number(clean) * 100)
  return minor <= 100_000_000_000 ? minor : null
}

/** Cêntimos → texto para o campo de edição (“15000” ou “15000,5”). */
export function priceToInput(priceMinor: number | undefined): string {
  if (priceMinor === undefined) return ''
  const value = priceMinor / 100
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}

export const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const

/** Dias ISO (1–7) em texto simples: “Seg a Sex”, “Seg, Qua”. */
export function formatWeekdays(weekdays: number[]): string {
  const days = [...weekdays].sort((a, b) => a - b)
  if (days.length === 7) return 'Todos os dias'
  const consecutive = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1)
  const label = (d: number) => WEEKDAY_SHORT[d - 1] ?? ''
  return consecutive ? `${label(days[0]!)} a ${label(days[days.length - 1]!)}` : days.map(label).join(', ')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Resumo da geração em linguagem simples (BR-CLN-12/15). */
export function generationLines(g: ClinicScheduleGenerationLike): string[] {
  const lines: string[] = []
  lines.push(
    g.created > 0
      ? `${plural(g.created, 'horário novo criado', 'horários novos criados')}.`
      : 'Não foi preciso criar horários novos.',
  )
  if (g.unchanged > 0) lines.push(`${plural(g.unchanged, 'horário já existia', 'horários já existiam')} e ficou como estava.`)
  if (g.removed > 0) {
    lines.push(`${plural(g.removed, 'horário livre removido', 'horários livres removidos')}, por já não corresponder${g.removed === 1 ? '' : 'em'} à regra.`)
  }
  if (g.skippedOverlap > 0) {
    lines.push(
      `${plural(g.skippedOverlap, 'horário ignorado', 'horários ignorados')} por coincidir${g.skippedOverlap === 1 ? '' : 'em'} com outro horário do mesmo profissional.`,
    )
  }
  if (g.skippedTimeOff > 0) {
    lines.push(
      `${plural(g.skippedTimeOff, 'horário ignorado', 'horários ignorados')} por cair${g.skippedTimeOff === 1 ? '' : 'em'} em férias ou bloqueio.`,
    )
  }
  if (g.keptBooked > 0) {
    lines.push(
      `${plural(g.keptBooked, 'horário mantido', 'horários mantidos')} porque já ${g.keptBooked === 1 ? 'tem' : 'têm'} marcações (trate-${g.keptBooked === 1 ? 'o' : 'os'} no Calendário).`,
    )
  }
  return lines
}
