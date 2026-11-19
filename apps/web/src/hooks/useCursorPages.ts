import { useState, type DependencyList } from 'react'
import { useToast } from '@/components/ui/Toast'
import { errorMessage } from '@/lib/errors'
import type { Page } from '@/types/marketplace'
import { useAsync } from './useAsync'

/**
 * Lista com cursor: a 1.ª página vem de `useAsync`; «Carregar mais» acrescenta as seguintes. As páginas seguintes
 * guardam a 1.ª a que pertencem: ao mudar de filtro (ou recarregar), deixam de valer.
 */
export function useCursorPages<T>(load: (cursor?: string) => Promise<Page<T>>, deps: DependencyList) {
  const toast = useToast()
  const first = useAsync(() => load(), deps)
  const [extra, setExtra] = useState<{ base: Page<T>; items: T[]; nextCursor: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const page = first.state.status === 'success' ? first.state.data : null
  const more = page && extra?.base === page ? extra : null
  const items = page ? [...page.items, ...(more?.items ?? [])] : []
  const nextCursor = more ? more.nextCursor : (page?.nextCursor ?? null)

  async function loadMore() {
    if (!page || !nextCursor) return
    setLoadingMore(true)
    try {
      const next = await load(nextCursor)
      setExtra({ base: page, items: [...(more?.items ?? []), ...next.items], nextCursor: next.nextCursor })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  return { state: first.state, reload: first.reload, items, nextCursor, loadMore, loadingMore }
}
