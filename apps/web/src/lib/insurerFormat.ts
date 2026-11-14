/** Moeda por omissão do módulo de seguradoras (BR-SEG-19, ADR-025/Q1): kwanza angolano. */
export const DEFAULT_CURRENCY = 'AOA'

/** “50 000,00 Kz”: valor na moeda da seguradora (ISO 4217); moeda desconhecida cai no código. */
export function formatMoney(amount: number, currency: string = DEFAULT_CURRENCY): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY
  // Kwanza: símbolo fixo “Kz” (o ICU de alguns ambientes mostra o código AOA).
  if (code === 'AOA') {
    return `${new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} Kz`
  }
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount} ${code}`
  }
}

/** “80 %”. */
export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(value)} %`
}

/** “30 dias”, “1 dia”. */
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`
}

/**
 * Valor escrito à mão em pt-PT: «15000,50», «1.500,50», «1 500», «1500.5». `null` se não for um valor positivo com até 2 casas.
 */
export function parseAmount(text: string): number | null {
  let t = text.trim().replace(/\s/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const value = Number(t)
  return value > 0 ? value : null
}
