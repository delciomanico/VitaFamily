import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { Page } from '@/types/insurerOps'

export interface PagedList<T> {
  status: 'loading' | 'success' | 'error'
  error: unknown
  items: T[]
  hasMore: boolean
  loadingMore: boolean
  /** Erro ao carregar mais: a lista já carregada mantém-se. */
  moreError: boolean
  loadMore: () => void
  reload: () => void
}

/**
 * Lista paginada por cursor (`{ items, nextCursor }`, api-overview): carrega a primeira página
 * quando `deps` mudam e acrescenta as seguintes com `loadMore`. Respostas de pedidos antigos são ignoradas.
 */
export function usePagedList<T>(load: (cursor?: string) => Promise<Page<T>>, deps: DependencyList): PagedList<T> {
  const [status, setStatus] = useState<PagedList<T>['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)

  // `deps` controla quando recarregar (como em useEffect).
  const stableLoad = useCallback(load, deps)

  // `reload` mantém a lista visível até chegar a nova resposta (senão os botões desaparecem sob o dedo do utilizador);
  // só uma mudança de `deps` (filtro, separador) volta ao estado de carregamento.
  const lastLoad = useRef(stableLoad)

  useEffect(() => {
    const current = ++generation.current
    const isReload = lastLoad.current === stableLoad
    lastLoad.current = stableLoad
    if (!isReload) setStatus('loading')
    setMoreError(false)
    stableLoad().then(
      (page) => {
        if (current !== generation.current) return
        setItems(page.items)
        setCursor(page.nextCursor)
        setStatus('success')
      },
      (err: unknown) => {
        if (current !== generation.current) return
        setError(err)
        setStatus('error')
      },
    )
    return () => {
      generation.current += 1
    }
  }, [stableLoad, attempt])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return
    const current = generation.current
    setLoadingMore(true)
    setMoreError(false)
    stableLoad(cursor).then(
      (page) => {
        if (current !== generation.current) return
        setItems((prev) => [...prev, ...page.items])
        setCursor(page.nextCursor)
        setLoadingMore(false)
      },
      () => {
        if (current !== generation.current) return
        setMoreError(true)
        setLoadingMore(false)
      },
    )
  }, [cursor, loadingMore, stableLoad])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, error, items, hasMore: cursor !== null, loadingMore, moreError, loadMore, reload }
}
