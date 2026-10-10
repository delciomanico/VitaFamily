import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { History } from 'lucide-react'
import { HistoryList } from '@/components/domain/HistoryList'
import { Locked } from '@/components/domain/Locked'
import { Page } from '@/components/layout/Page'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { isAppError } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { familyService } from '@/services/family.service'
import type { HistoryEntryKind } from '@/types/history'

type Filter = 'ALL' | Exclude<HistoryEntryKind, 'HISTORY'>

const filters: TabItem<Filter>[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'APPOINTMENT', label: 'Consultas' },
  { value: 'EXAMINATION', label: 'Exames' },
  { value: 'PRESCRIPTION', label: 'Receitas' },
]

/** Histórico completo de um membro, só com as categorias que o utilizador pode ver. */
export function MemberHistoryPage() {
  const { id = '' } = useParams()
  const { user, family } = useAuth()
  const [filter, setFilter] = useState<Filter>('ALL')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.getMemberHistory(familyId, userId, id), [familyId, userId, id])

  const entries =
    state.status === 'success' ? state.data.entries.filter((e) => filter === 'ALL' || e.kind === filter) : []

  return (
    <Page
      title={state.status === 'success' ? `Histórico de ${firstName(state.data.member.name)}` : 'Histórico completo'}
      backTo={paths.familyMember(id)}
      backLabel="Membro"
    >
      <Tabs label="Filtrar histórico" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este membro não existe ou não pertence à sua família." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <>
          {entries.length > 0 ? (
            <div role="tabpanel">
              <HistoryList entries={entries} linked={state.data.manage} />
            </div>
          ) : (
            <EmptyState icon={History} title="Sem histórico para mostrar." />
          )}
          {state.data.hidden.map((category) => (
            <Locked key={category} category={category} ownerName={state.data.member.name} />
          ))}
        </>
      )}
    </Page>
  )
}
