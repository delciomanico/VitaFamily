import { AppError } from './errors'

/**
 * Defesas contra respostas inesperadas da API (valores de enum novos, corpo que não é JSON, campos em falta).
 * A UI nunca deve rebentar por algo que o backend acrescentou ou devolveu fora do contrato.
 */

/** Corpo da resposta como JSON. Corpo vazio → `undefined`; não-JSON (HTML de proxy, 502…) → `AppError('UNKNOWN')`. */
export function parseJsonBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AppError('UNKNOWN')
  }
}

/**
 * Mapa que nunca devolve `undefined`: uma chave desconhecida (p. ex. um estado ou tipo novo no backend)
 * recebe o valor de `fallback(chave)` em vez de fazer a página rebentar.
 */
export function withFallback<K extends string, V>(map: Record<K, V>, fallback: (key: string) => V): Record<K, V> {
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver) as unknown
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop as K]
      // Propriedades de Object.prototype (toString, constructor…) e `then` não são chaves de domínio.
      if (prop in target || prop === 'then' || prop === 'toJSON') return Reflect.get(target, prop, receiver) as unknown
      return fallback(prop)
    },
  })
}

/** Array garantido: `null`/`undefined`/objeto inesperado → `[]`. */
export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}
