import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { TabHeader } from '@/components/app/ScreenHeader'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { cn } from '@/lib/cn'
import { formatDayMonth, formatTimeLuanda, luandaDayISO } from '@/lib/format'
import { closedByLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { professionalConversationService } from '@/services/professionalConversation.service'
import type { ProfessionalConversation } from '@/types/marketplace'

type StatusFilter = 'OPEN' | 'CLOSED' | 'ALL'

const CHIPS: ChipItem<StatusFilter>[] = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'CLOSED', label: 'Fechadas' },
  { value: 'ALL', label: 'Todas' },
]

/** «15:30» se for hoje, «Ontem», ou «15 out». */
function chatTime(value: string, now: Date = new Date()): string {
  const day = luandaDayISO(value)
  if (day === luandaDayISO(now)) return formatTimeLuanda(value)
  if (day === luandaDayISO(new Date(now.getTime() - 86_400_000))) return 'Ontem'
  return formatDayMonth(day)
}

function lineText(row: ProfessionalConversation): string {
  if (row.unreadCount > 0) return row.unreadCount === 1 ? '1 mensagem nova' : `${row.unreadCount} mensagens novas`
  if (row.status === 'CLOSED') return row.closedBy ? closedByLabel[row.closedBy] : 'Conversa fechada'
  if (!row.canSend) return 'Só leitura'
  return 'Sem mensagens novas'
}

/** Conversas do profissional com famílias, como numa app de mensagens. Só a identidade de apresentação da família (nunca ids). */
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
    <div className="flex flex-col gap-5">
      <TabHeader title="Conversas" />

      {notApproved && <LockedNotice>A sua conta não está aprovada: as conversas estão só de leitura.</LockedNotice>}

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}

      {list.state.status === 'success' && (
        <>
          <FilterChips items={CHIPS} value={filter} onChange={setFilter} label="Estado das conversas" />

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
              <MessageCircle className="size-10 text-muted" aria-hidden />
              <p className="text-lg font-semibold">{all.length === 0 ? 'Ainda não tem conversas' : 'Não há conversas nesta lista'}</p>
              {all.length === 0 && (
                <>
                  <p className="text-base text-muted">As famílias podem iniciar uma conversa consigo a partir do mercado. Um perfil completo ajuda a ser encontrado.</p>
                  <ButtonLink to={paths.professionalProfile} variant="soft" size="lg">
                    Ver o meu perfil
                  </ButtonLink>
                </>
              )}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link to={paths.professionalConversation(row.id)} className="flex min-h-20 items-center gap-3 px-4 py-3 transition-colors active:bg-surface-muted hover:bg-surface-muted/60">
                    <Avatar name={row.participantLabel} size="lg" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('truncate text-lg leading-6', row.unreadCount > 0 ? 'font-bold' : 'font-semibold')}>{row.participantLabel}</span>
                      <span className={cn('truncate text-base', row.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted')}>{lineText(row)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <time dateTime={row.lastMessageAt} className={cn('text-sm', row.unreadCount > 0 ? 'font-semibold text-primary' : 'text-muted')}>
                        {chatTime(row.lastMessageAt)}
                      </time>
                      {row.unreadCount > 0 && (
                        <span
                          role="img"
                          aria-label={row.unreadCount === 1 ? '1 mensagem por ler' : `${row.unreadCount} mensagens por ler`}
                          className="flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-sm leading-6 font-semibold text-primary-foreground tabular-nums"
                        >
                          {row.unreadCount}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
