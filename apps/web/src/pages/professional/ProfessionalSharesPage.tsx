import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Share2 } from 'lucide-react'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { categoriesText, professionalShareStatusText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { professionalShareService } from '@/services/professionalShare.service'

type Filter = 'AVAILABLE' | 'ALL'

const CHIPS: ChipItem<Filter>[] = [
  { value: 'AVAILABLE', label: 'Para abrir' },
  { value: 'ALL', label: 'Todas' },
]

/** Partilhas recebidas (UC-MKT-53): só o rótulo do participante, as categorias e o prazo; nunca família, membro nem utilizador. */
export function ProfessionalSharesPage() {
  usePageTitle('Registos partilhados consigo')
  const [params] = useSearchParams()
  const bookingId = params.get('marcacao') ?? undefined
  const profile = useProfessionalProfile()
  const [filter, setFilter] = useState<Filter>('AVAILABLE')
  const list = useCursorPages((cursor) => professionalShareService.list({ bookingId, cursor }), [bookingId])
  const status = profile.profile?.validationStatus
  const notApproved = status === 'SUSPENDED' || status === 'REJECTED' || status === 'DRAFT' || status === 'PENDING_REVIEW'
  const rows = list.items.filter((s) => filter === 'ALL' || (s.status === 'ACTIVE' && s.canOpen))

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title="Partilhas recebidas"
        backTo={bookingId ? paths.professionalBooking(bookingId) : paths.professionalProfile}
        backLabel={bookingId ? 'Marcação' : 'Perfil'}
        subtitle="Registos que as famílias partilharam consigo, por tempo limitado, depois de uma marcação confirmada."
      />
      {notApproved && <LockedNotice>A sua conta não está aprovada: pode ver a lista, mas não abrir partilhas.</LockedNotice>}
      <FilterChips items={CHIPS} value={filter} onChange={setFilter} label="Estado das partilhas" />

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
            <Share2 className="size-10 text-muted" aria-hidden />
            <p className="text-lg font-semibold">Sem partilhas nesta lista.</p>
            <p className="text-base text-muted">Quando uma família partilhar o registo consigo, a partilha aparece aqui.</p>
            {filter === 'AVAILABLE' && list.items.length > 0 && (
              <Button variant="soft" size="lg" onClick={() => setFilter('ALL')}>
                Ver também as que já passaram
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {rows.map((s) => {
                const text = professionalShareStatusText(s.status, s.canOpen)
                return (
                  <li key={s.id}>
                    <Link
                      to={paths.professionalShare(s.id)}
                      className="flex min-h-[5.5rem] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong active:bg-surface-muted"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-lg leading-6 font-semibold">{s.participantLabel}</span>
                        <span className="text-base text-muted">{categoriesText(s.categories)}</span>
                        <span className="text-base">{s.status === 'ACTIVE' && s.canOpen ? `Até ${formatWhenLuanda(s.expiresAt)}` : 'Já não pode ser aberta'}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={text.tone} dot>
                            {text.label}
                          </Badge>
                          {s.viewOnce && <Badge tone="neutral">Só abre uma vez</Badge>}
                        </span>
                      </span>
                      <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
                    </Link>
                  </li>
                )
              })}
            </ul>
            {list.nextCursor && (
              <Button variant="secondary" size="lg" fullWidth onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Ver mais
              </Button>
            )}
          </>
        ))}
    </div>
  )
}
