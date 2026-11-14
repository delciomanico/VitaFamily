import type { ReactNode } from 'react'
import { Boxes, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { isAppError } from '@/lib/errors'
import type { PagedList } from '@/hooks/usePagedList'

/**
 * Estado de um pedido do módulo operacional. `NOT_FOUND` em qualquer recurso do módulo significa
 * «módulo operacional não ativo para esta seguradora» (contrato: senão 404); `FORBIDDEN`, papel sem acesso.
 */
export function ModuleError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isAppError(error, 'NOT_FOUND')) {
    return (
      <EmptyState
        icon={Boxes}
        title="Módulo operacional não ativo."
        description="Esta seguradora ainda não tem o módulo operacional ligado. Peça à equipa Vita Family para o ativar."
      />
    )
  }
  if (isAppError(error, 'FORBIDDEN')) {
    return <EmptyState icon={Lock} title="Sem acesso." description="O seu papel não permite ver esta área." />
  }
  return <ErrorState onRetry={onRetry} />
}

interface PagedViewProps<T> {
  list: PagedList<T>
  empty: ReactNode
  children: (items: T[]) => ReactNode
}

/** Loading / erro / vazio / lista com «Carregar mais»; um item inesperado não deixa a página em branco. */
export function PagedView<T>({ list, empty, children }: PagedViewProps<T>) {
  if (list.status === 'loading') return <LoadingState rows={3} />
  if (list.status === 'error') return <ModuleError error={list.error} onRetry={list.reload} />
  if (list.items.length === 0) return <>{empty}</>
  return (
    <ErrorBoundary resetKey={list.items.length}>
      <div className="flex flex-col gap-3">
        {children(list.items)}
        {list.moreError && <ErrorState message="Não foi possível carregar mais." onRetry={list.loadMore} />}
        {list.hasMore && !list.moreError && (
          <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore} className="self-center">
            Carregar mais
          </Button>
        )}
      </div>
    </ErrorBoundary>
  )
}
