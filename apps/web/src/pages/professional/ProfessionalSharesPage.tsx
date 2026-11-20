import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Share2 } from 'lucide-react'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { categoriesText, professionalShareStatusText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { professionalShareService } from '@/services/professionalShare.service'

type Filter = 'AVAILABLE' | 'ALL'

const filterItems: TabItem<Filter>[] = [
  { value: 'AVAILABLE', label: 'Disponíveis' },
  { value: 'ALL', label: 'Todas' },
]

/** Partilhas recebidas (UC-MKT-53): só o rótulo do participante, as categorias e o prazo; nunca família, membro nem utilizador. */
export function ProfessionalSharesPage() {
  usePageTitle('Partilhas')
  const [params] = useSearchParams()
  const bookingId = params.get('marcacao') ?? undefined
  const profile = useProfessionalProfile()
  const [filter, setFilter] = useState<Filter>('AVAILABLE')
  const list = useCursorPages((cursor) => professionalShareService.list({ bookingId, cursor }), [bookingId])
  const status = profile.profile?.validationStatus
  const notApproved = status === 'SUSPENDED' || status === 'REJECTED' || status === 'DRAFT' || status === 'PENDING_REVIEW'
  const rows = list.items.filter((s) => filter === 'ALL' || (s.status === 'ACTIVE' && s.canOpen))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Partilhas recebidas</h1>
      <p className="text-sm text-muted">Registos que as famílias partilharam consigo, por tempo limitado, depois de uma marcação confirmada.</p>
      {notApproved && <LockedNotice>A sua conta não está aprovada: pode ver a lista, mas não abrir partilhas.</LockedNotice>}
      <Tabs items={filterItems} value={filter} onChange={setFilter} label="Estado das partilhas" />

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (rows.length === 0 ? (
          <EmptyState icon={Share2} title="Sem partilhas nesta lista." description="Quando uma família partilhar o registo consigo, a partilha aparece aqui." />
        ) : (
          <>
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((s) => {
                  const text = professionalShareStatusText(s.status, s.canOpen)
                  return (
                    <li key={s.id}>
                      <RowLink to={paths.professionalShare(s.id)}>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <p className="truncate font-medium">{s.participantLabel}</p>
                          <p className="text-sm text-muted">{categoriesText(s.categories)}</p>
                          <p className="text-sm">{s.status === 'ACTIVE' && s.canOpen ? `Até ${formatWhenLuanda(s.expiresAt)}` : 'Já não pode ser aberta'}</p>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={text.tone} dot>
                              {text.label}
                            </Badge>
                            {s.viewOnce && <Badge tone="neutral">Só abre uma vez</Badge>}
                          </span>
                        </div>
                      </RowLink>
                    </li>
                  )
                })}
              </ul>
            </Card>
            {list.nextCursor && (
              <Button variant="secondary" onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Carregar mais
              </Button>
            )}
          </>
        ))}
    </div>
  )
}
