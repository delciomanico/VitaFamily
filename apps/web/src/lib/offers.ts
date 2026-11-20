import { errorMessage, isAppError } from '@/lib/errors'
import { MAX_PRICE_KZ } from '@/types/professional'

export const MAX_NOTE_LENGTH = 200
export const MAX_ACTIVE_OFFERS = 20

/** Mensagens específicas das regras de oferta (BR-MKT-24/31); o resto vem de `errorMessage`. */
export function offerErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Já tem um serviço ativo com esta especialidade, método e duração.'
  if (isAppError(error, 'LIMIT_EXCEEDED')) return `Pode ter até ${MAX_ACTIVE_OFFERS} serviços ativos. Desative um para continuar.`
  return errorMessage(error)
}

/** Preço em Kwanza inteiro, sem cêntimos, entre 0 e o máximo (BR-MKT-24). */
export function parsePrice(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value <= MAX_PRICE_KZ ? value : null
}
