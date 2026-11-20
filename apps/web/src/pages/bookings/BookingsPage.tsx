import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatWhenLuanda } from '@/lib/format'
import { offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { consultationService } from '@/services/consultation.service'
import { conversationService } from '@/services/conversation.service'
import type { FamilyBooking } from '@/types/consultations'

type Filter = 'ACTIVE' | 'PAST' | 'ALL'

const filterItems: TabItem<Filter>[] = [
  { value: 'ACTIVE', label: 'Em curso' },
  { value: 'PAST', label: 'Anteriores' },
  { value: 'ALL', label: 'Todas' },
]

type Row = FamilyBooking & { memberName: string }

/** Marcações da família com profissionais, de todos os membros em nome de quem pode marcar (MK3). */
export function BookingsPage() {
  usePageTitle('Marcações')
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const list = useAsync(async (): Promise<Row[]> => {
    if (!familyId || !userId) return []
    const members = await conversationService.eligibleMembers(familyId, userId)
    const lists = await Promise.all(members.map((m) => consultationService.list(familyId, userId, m.id).then((page) => page.items.map((item) => ({ ...item, memberName: m.name })))))
    return lists.flat().sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  }, [familyId, userId])

  const all = list.state.status === 'success' ? list.state.data : []
  const isActive = (b: Row) => b.status === 'REQUESTED' || b.status === 'CONFIRMED'
  // As em curso por ordem da mais próxima; as anteriores da mais recente.
  const rows = all.filter((b) => (filter === 'ALL' ? true : filter === 'ACTIVE' ? isActive(b) : !isActive(b)))
  if (filter === 'ACTIVE') rows.reverse()
  const severalMembers = new Set(all.map((b) => b.memberId)).size > 1

  return (
    <Page
      title="Marcações"
      backTo={paths.home}
      action={
        <ButtonLink to={paths.shares} variant="secondary" size="sm">
          Partilhas com profissionais
        </ButtonLink>
      }
    >
      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}
      {list.state.status === 'success' && (
        <div className="flex flex-col gap-4">
          <Tabs items={filterItems} value={filter} onChange={setFilter} label="Estado das marcações" />
          {rows.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title={all.length === 0 ? 'Ainda não tem marcações' : 'Não há marcações nesta lista'}
              description={all.length === 0 ? 'Escolha um profissional e um horário livre para marcar uma consulta.' : undefined}
              action={
                all.length === 0 ? (
                  <ButtonLink to={paths.marketplace} size="sm">
                    Encontrar profissionais
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((b) => (
                  <li key={b.id}>
                    <RowLink to={paths.booking(b.memberId, b.id)}>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="truncate font-medium">{b.professional.displayName}</p>
                        <p className="text-sm text-muted">
                          {b.offer.specialtyName} · {offerMethodLabel[b.offer.method]}
                          {severalMembers ? ` · ${b.memberName}` : ''}
                        </p>
                        <time className="text-sm" dateTime={b.startsAt}>
                          {formatWhenLuanda(b.startsAt)}
                        </time>
                        <StatusBadges status={b.status} paymentStatus={b.paymentStatus} priceKz={b.priceKz} />
                        {b.canSendProof && <p className="text-sm font-medium text-warning">Falta enviar o comprovativo de pagamento.</p>}
                        {b.canReview && <p className="text-sm font-medium text-primary">Pode avaliar esta consulta.</p>}
                      </div>
                    </RowLink>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </Page>
  )
}
