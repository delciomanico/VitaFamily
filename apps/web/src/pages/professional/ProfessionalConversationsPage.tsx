import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatWhenLuanda } from '@/lib/format'
import { closedByLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { professionalConversationService } from '@/services/professionalConversation.service'

type StatusFilter = 'OPEN' | 'CLOSED' | 'ALL'

const filterItems: TabItem<StatusFilter>[] = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'CLOSED', label: 'Fechadas' },
  { value: 'ALL', label: 'Todas' },
]

/** Conversas do profissional com famílias. Só a identidade de apresentação da família (nunca ids). */
export function ProfessionalConversationsPage() {
  usePageTitle('Conversas')
  const profile = useProfessionalProfile()
  const list = useAsync(() => professionalConversationService.list(), [])
  const [filter, setFilter] = useState<StatusFilter>('OPEN')

  const status = profile.profile?.validationStatus
  const notApproved = status === 'SUSPENDED' || status === 'REJECTED'
  const all = list.state.status === 'success' ? list.state.data.items : []
  const rows = all.filter((row) => filter === 'ALL' || row.status === filter)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Conversas</h1>

      {notApproved && <LockedNotice>A sua conta não está aprovada: as conversas estão só de leitura.</LockedNotice>}

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}

      {list.state.status === 'success' && (
        <>
          <Tabs items={filterItems} value={filter} onChange={setFilter} label="Estado das conversas" />

          {rows.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={all.length === 0 ? 'Ainda não tem conversas' : 'Não há conversas nesta lista'}
              description={
                all.length === 0 ? 'As famílias podem iniciar uma conversa consigo a partir do mercado.' : undefined
              }
            />
          ) : (
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((row) => (
                  <li key={row.id}>
                    <RowLink to={paths.professionalConversation(row.id)}>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="truncate font-medium">{row.participantLabel}</p>
                        <p className="text-sm text-muted">
                          Última mensagem: <time dateTime={row.lastMessageAt}>{formatWhenLuanda(row.lastMessageAt)}</time>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {row.unreadCount > 0 && (
                          <span
                            role="img"
                            aria-label={row.unreadCount === 1 ? '1 mensagem por ler' : `${row.unreadCount} mensagens por ler`}
                          >
                            <Badge tone="primary">{row.unreadCount}</Badge>
                          </span>
                        )}
                        {row.status === 'CLOSED' ? (
                          <Badge>{row.closedBy ? closedByLabel[row.closedBy] : 'Fechada'}</Badge>
                        ) : (
                          !row.canSend && <Badge>Só leitura</Badge>
                        )}
                      </div>
                    </RowLink>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
