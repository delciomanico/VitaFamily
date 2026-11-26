import { vi } from 'vitest'

/**
 * Fixa SÓ o relógio (`Date`) hoje às 15:00. Os dados de demonstração são relativos a «agora» e alguns testes só valiam a certas horas.
 * Chamar no `beforeEach` ANTES de repor os dados; `vi.useRealTimers()` no `afterEach`.
 */
export function pinClockToAfternoon(): void {
  const afternoon = new Date()
  afternoon.setHours(15, 0, 0, 0)
  // O relógio continua a andar a partir daí (a verificação antivírus simulada depende do tempo decorrido).
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(afternoon)
}
