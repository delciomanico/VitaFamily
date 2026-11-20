import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatWhenLuanda } from '@/lib/format'
import { categoriesText, familyShareStatusText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { conversationService } from '@/services/conversation.service'
import { recordShareService } from '@/services/recordShare.service'
import type { RecordShare } from '@/types/recordSharing'

type Filter = 'ACTIVE' | 'ENDED' | 'ALL'

const filterItems: TabItem<Filter>[] = [
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'ENDED', label: 'Terminadas' },
  { value: 'ALL', label: 'Todas' },
]

type Row = RecordShare & { memberId: string; memberName: string }

/** Partilhas do registo com profissionais, de todos os membros em nome de quem a família pode partilhar (UC-MKT-50). */
export function SharesPage() {
  usePageTitle('Partilhas com profissionais')
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const list = useAsync(async (): Promise<Row[]> => {
    if (!familyId || !userId) return []
    const members = await conversationService.eligibleMembers(familyId, userId)
    const lists = await Promise.all(members.map((m) => recordShareService.list(familyId, userId, m.id).then((page) => page.items.map((item) => ({ ...item, memberId: m.id, memberName: m.name })))))
    return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [familyId, userId])

  const all = list.state.status === 'success' ? list.state.data : []
  const rows = all.filter((s) => (filter === 'ALL' ? true : filter === 'ACTIVE' ? s.status === 'ACTIVE' : s.status !== 'ACTIVE'))
  const severalMembers = new Set(all.map((s) => s.memberId)).size > 1

  return (
    <Page title="Partilhas com profissionais" backTo={paths.bookings} backLabel="Marcações">
      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}
      {list.state.status === 'success' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Aqui vê o que partilhou, até quando e quem já abriu. Pode parar uma partilha quando quiser.</p>
          <Tabs items={filterItems} value={filter} onChange={setFilter} label="Estado das partilhas" />
          {rows.length === 0 ? (
            <EmptyState
              icon={Share2}
              title={all.length === 0 ? 'Ainda não partilhou o seu registo' : 'Não há partilhas nesta lista'}
              description={all.length === 0 ? 'Numa marcação confirmada, pode partilhar com o profissional o que escolher, por tempo limitado.' : undefined}
              action={
                all.length === 0 ? (
                  <ButtonLink to={paths.bookings} size="sm">
                    Ver as minhas marcações
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((s) => (
                  <li key={s.id}>
                    <RowLink to={paths.share(s.memberId, s.id)}>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="truncate font-medium">{s.professional.displayName}</p>
                        <p className="text-sm text-muted">
                          {categoriesText(s.categories)}
                          {severalMembers ? ` · ${s.memberName}` : ''}
                        </p>
                        <p className="text-sm">{s.status === 'ACTIVE' ? `Até ${formatWhenLuanda(s.expiresAt)}` : `Prazo: ${formatWhenLuanda(s.expiresAt)}`}</p>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={familyShareStatusText[s.status].tone} dot>
                            {familyShareStatusText[s.status].label}
                          </Badge>
                          <span className="text-sm text-muted">{s.viewCount === 0 ? 'Ainda não foi aberta' : s.viewCount === 1 ? 'Aberta 1 vez' : `Aberta ${s.viewCount} vezes`}</span>
                        </span>
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
