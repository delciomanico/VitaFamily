import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { formatWhenLuanda } from '@/lib/format'
import { paths } from '@/routes/paths'
import { conversationService, type FamilyConversationRow } from '@/services/conversation.service'

type StatusFilter = 'OPEN' | 'CLOSED' | 'ALL'

const filterItems: ChipItem<StatusFilter>[] = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'CLOSED', label: 'Fechadas' },
  { value: 'ALL', label: 'Todas' },
]

/** Conversas da família com profissionais, de todos os membros em que pode conversar (MK2). */
export function ConversationsPage() {
  const { user, family } = useAuth()
  const familyId = family?.id
  const userId = user?.id
  const [filter, setFilter] = useState<StatusFilter>('OPEN')
  const list = useAsync(
    () =>
      familyId && userId
        ? conversationService.listAll(familyId, userId)
        : Promise.resolve<FamilyConversationRow[]>([]),
    [familyId, userId],
  )

  const all = list.state.status === 'success' ? list.state.data : []
  const rows = all.filter((row) => filter === 'ALL' || row.status === filter)
  // "Em nome de" só faz sentido quando a família tem mais do que um membro com conversas possíveis.
  const severalMembers = new Set(all.map((row) => row.memberId)).size > 1

  return (
    <Page title="Conversas" backTo={paths.home}>
      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}

      {list.state.status === 'success' && (
        <div className="flex flex-col gap-4">
          <FilterChips items={filterItems} value={filter} onChange={setFilter} label="Estado das conversas" />

          {rows.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={all.length === 0 ? 'Ainda não tem conversas' : 'Não há conversas nesta lista'}
              description={
                all.length === 0 ? 'Quando iniciar uma conversa com um profissional, ela aparece aqui.' : undefined
              }
              action={
                all.length === 0 ? (
                  <ButtonLink to={paths.marketplace} size="xl">
                    Encontrar profissionais
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={`${row.memberId}:${row.id}`}>
                  <Link to={paths.messageThread(row.memberId, row.id)} className="flex min-h-[4.5rem] items-center gap-3 rounded-[1.25rem] bg-surface p-4 shadow-card transition-transform active:scale-[0.98]">
                    <Avatar name={row.professional.displayName} size="lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="truncate text-lg font-semibold">{row.professional.displayName}</p>
                      {severalMembers && <p className="text-base text-muted">Em nome de {row.memberName}</p>}
                      <p className="text-base text-muted">Tratado/a como {row.participantLabel}</p>
                      <time className="text-sm text-muted" dateTime={row.lastMessageAt}>
                        {formatWhenLuanda(row.lastMessageAt)}
                      </time>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {row.unreadCount > 0 && (
                        <span role="img" aria-label={row.unreadCount === 1 ? '1 mensagem por ler' : `${row.unreadCount} mensagens por ler`}>
                          <Badge tone="primary">{row.unreadCount}</Badge>
                        </span>
                      )}
                      {row.status === 'CLOSED' ? <Badge>Fechada</Badge> : !row.canSend && <Badge>Indisponível</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Page>
  )
}
