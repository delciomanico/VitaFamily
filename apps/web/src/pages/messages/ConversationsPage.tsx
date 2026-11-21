import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { formatShortDateLuanda, formatTimeLuanda, luandaDayISO } from '@/lib/format'
import { paths } from '@/routes/paths'
import { conversationService, type FamilyConversationRow } from '@/services/conversation.service'

type StatusFilter = 'OPEN' | 'CLOSED' | 'ALL'

const filterItems: ChipItem<StatusFilter>[] = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'CLOSED', label: 'Fechadas' },
  { value: 'ALL', label: 'Todas' },
]

/** Hora se for de hoje (Luanda), senão o dia e o mês. */
function shortWhen(value: string): string {
  return luandaDayISO(value) === luandaDayISO(new Date()) ? formatTimeLuanda(value) : formatShortDateLuanda(value)
}

/** Linha de uma conversa: foto, nome, última mensagem e hora (mais a bolinha de não lidas). */
function ConversationRowCard({ row, familyId, userId }: { row: FamilyConversationRow; familyId: string; userId: string }) {
  const last = useAsync(() => conversationService.lastMessage(familyId, userId, row.memberId, row.id), [familyId, userId, row.memberId, row.id, row.lastMessageAt])
  const message = last.state.status === 'success' ? last.state.data : null
  const preview = message ? (message.hidden ? 'Mensagem removida' : `${message.mine ? 'Você: ' : ''}${message.text ?? ''}`) : last.state.status === 'loading' ? '' : 'Sem mensagens'
  const unread = row.unreadCount > 0
  return (
    <Link
      to={paths.messageThread(row.memberId, row.id)}
      aria-label={unread ? `${row.professional.displayName}, ${row.unreadCount === 1 ? '1 mensagem por ler' : `${row.unreadCount} mensagens por ler`}` : undefined}
      className="-mx-4 flex items-center gap-3 px-4 transition-colors active:bg-surface-muted lg:-mx-8 lg:px-8"
    >
      <Avatar name={row.professional.displayName} size="lg" className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col border-b border-border py-3">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-base font-semibold">{row.professional.displayName}</span>
          <time className={unread ? 'shrink-0 text-sm font-semibold text-primary' : 'shrink-0 text-sm text-muted'} dateTime={row.lastMessageAt}>
            {shortWhen(row.lastMessageAt)}
          </time>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={unread ? 'truncate text-sm font-medium text-foreground' : 'truncate text-sm text-muted'}>{preview || '\u00a0'}</span>
          {unread && (
            <span aria-hidden className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {row.unreadCount > 9 ? '9+' : row.unreadCount}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}

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
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li key={`${row.memberId}:${row.id}`}>
                  <ConversationRowCard row={row} familyId={familyId ?? ''} userId={userId ?? ''} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Page>
  )
}
