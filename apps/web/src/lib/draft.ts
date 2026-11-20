import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Rascunho de um assistente (passo a passo) no separador do browser: quem sai a meio e volta encontra o que já
 * preencheu. Nunca guarda ficheiros nem dados de saúde; apaga-se ao guardar ou ao terminar a sessão.
 */
const PREFIX = 'vf.professional.draft.'

export function clearProfessionalDrafts(): void {
  try {
    for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(PREFIX)) window.sessionStorage.removeItem(key)
  } catch {
    // Sem armazenamento disponível: nada a limpar.
  }
}

export function useDraft<T>(name: string, initial: T): [T, (patch: Partial<T> | ((current: T) => T)) => void, () => void] {
  const key = PREFIX + name
  const initialRef = useRef(initial)
  const cleared = useRef(false)
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(key)
      if (raw) return { ...initial, ...(JSON.parse(raw) as T) }
    } catch {
      // Rascunho ilegível: recomeça do valor inicial.
    }
    return initial
  })

  useEffect(() => {
    if (cleared.current) return
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Sem armazenamento: o rascunho só vive enquanto o ecrã estiver aberto.
    }
  }, [key, value])

  const update = useCallback((patch: Partial<T> | ((current: T) => T)) => {
    setValue((current) => (typeof patch === 'function' ? patch(current) : { ...current, ...patch }))
  }, [])

  const clear = useCallback(() => {
    cleared.current = true
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // Nada a limpar.
    }
    setValue(initialRef.current)
  }, [key])

  return [value, update, clear]
}
