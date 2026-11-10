import { describe, expect, it } from 'vitest'
import { AppError } from './errors'
import { appointmentStatus, alertCategoryOf, alertTitle } from './labels'
import { asArray, parseJsonBody, withFallback } from './safe'

describe('parseJsonBody', () => {
  it('devolve undefined para corpo vazio e o objeto para JSON válido', () => {
    expect(parseJsonBody('')).toBeUndefined()
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 })
  })
  it('corpo que não é JSON (HTML de proxy) vira AppError UNKNOWN em vez de SyntaxError', () => {
    expect(() => parseJsonBody('<html>502 Bad Gateway</html>')).toThrow(AppError)
  })
})

describe('withFallback', () => {
  const map = withFallback({ A: 'a' } as Record<string, string>, (key) => `?${key}`)
  it('mantém chaves conhecidas e dá fallback às desconhecidas', () => {
    expect(map.A).toBe('a')
    expect(map.NOVO).toBe('?NOVO')
  })
  it('não interfere com propriedades de objeto nem com serialização', () => {
    expect(typeof map.toString).toBe('function')
    expect(JSON.stringify(map)).toBe('{"A":"a"}')
  })
})

describe('mapas de domínio com valores novos do backend', () => {
  it('estado desconhecido não rebenta e fica neutro', () => {
    const unknown = (appointmentStatus as Record<string, { label: string; tone: string }>).ESTADO_NOVO
    expect(unknown).toEqual({ label: 'Outro', tone: 'neutral' })
  })
  it('tipo de alerta desconhecido tem categoria e título genéricos', () => {
    expect((alertCategoryOf as Record<string, string>).TIPO_NOVO).toBe('OTHER')
    expect(alertTitle({ type: 'TIPO_NOVO' as never, ruleKey: 'x' as never, sourceLabel: '', message: undefined })).toBe(
      'Tem um novo aviso.',
    )
  })
})

describe('asArray', () => {
  it('null, undefined e valores não-array → []', () => {
    expect(asArray(null)).toEqual([])
    expect(asArray(undefined)).toEqual([])
    expect(asArray({} as never)).toEqual([])
    expect(asArray([1])).toEqual([1])
  })
})
