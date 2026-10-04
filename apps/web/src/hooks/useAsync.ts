import { useCallback, useEffect, useState, type DependencyList } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown }

/**
 * Carrega dados de um serviço e expõe os estados Loading / Success / Error.
 * O estado Empty é decidido por cada tela a partir de `data`.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // `deps` controla quando recarregar (como em useEffect).
  const stableLoad = useCallback(load, deps)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    stableLoad().then(
      (data) => active && setState({ status: 'success', data }),
      (error: unknown) => active && setState({ status: 'error', error }),
    )
    return () => {
      active = false
    }
  }, [stableLoad, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, reload }
}
