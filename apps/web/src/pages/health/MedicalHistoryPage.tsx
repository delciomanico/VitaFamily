import { useState } from 'react'
import { History } from 'lucide-react'
import { HistoryList } from '@/components/domain/HistoryList'
import { Page } from '@/components/layout/Page'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { paths } from '@/routes/paths'
import { healthService } from '@/services/health.service'
import type { HistoryEntryKind } from '@/types/history'

type Filter = 'ALL' | Exclude<HistoryEntryKind, 'HISTORY'>

const filters: TabItem<Filter>[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'APPOINTMENT', label: 'Consultas' },
  { value: 'EXAMINATION', label: 'Exames' },
  { value: 'PRESCRIPTION', label: 'Receitas' },
]

export function MedicalHistoryPage() {
  const { user, family, member } = useAuth()
  const [filter, setFilter] = useState<Filter>('ALL')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const memberId = member?.id ?? ''
  const { state, reload } = useAsync(
    () => healthService.getMedicalHistory(familyId, userId, memberId),
    [familyId, userId, memberId],
  )

  const entries =
    state.status === 'success' ? state.data.filter((e) => filter === 'ALL' || e.kind === filter) : []

  return (
    <Page title="Histórico médico" backTo={paths.health} backLabel="Saúde">
      <Tabs label="Filtrar histórico" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (entries.length === 0 ? (
          <EmptyState icon={History} title="Ainda não existe histórico." description="Consultas, exames e receitas anteriores aparecem aqui." />
        ) : (
          <div role="tabpanel">
            <HistoryList entries={entries} />
          </div>
        ))}
    </Page>
  )
}
