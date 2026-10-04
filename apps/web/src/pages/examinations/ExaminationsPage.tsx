import { useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { ExaminationList } from '@/components/domain/ExaminationList'
import { Page } from '@/components/layout/Page'
import { ButtonLink } from '@/components/ui/Button'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isRecentExam } from '@/lib/examination'
import { paths } from '@/routes/paths'
import { examinationService } from '@/services/examination.service'

type Filter = 'RECENT' | 'HISTORY'

const filters: TabItem<Filter>[] = [
  { value: 'RECENT', label: 'Recentes' },
  { value: 'HISTORY', label: 'Histórico' },
]

const addIcon = <Plus className="size-4" aria-hidden />

export function ExaminationsPage() {
  const { user, family, member } = useAuth()
  const [filter, setFilter] = useState<Filter>('RECENT')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => examinationService.listExaminations(familyId, userId), [familyId, userId])

  const items =
    state.status === 'success' ? state.data.filter((e) => (filter === 'RECENT') === isRecentExam(e.examination)) : []

  return (
    <Page
      title="Exames"
      backTo={paths.health}
      backLabel="Saúde"
      action={
        <ButtonLink to={paths.examinationNew} size="sm" icon={addIcon}>
          Adicionar
        </ButtonLink>
      }
    >
      <Tabs label="Filtrar exames" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (items.length > 0 ? (
          <div role="tabpanel">
            <ExaminationList items={items} selfMemberId={member?.id} />
          </div>
        ) : filter === 'RECENT' ? (
          <EmptyState
            icon={FlaskConical}
            title="Ainda não existem exames."
            description="Registe exames e resultados para acompanhar a evolução ao longo do tempo."
            action={
              <ButtonLink to={paths.examinationNew} icon={addIcon}>
                Adicionar exame
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={FlaskConical}
            title="Sem exames anteriores."
            description="Exames com mais de 90 dias ou cancelados aparecem aqui."
          />
        ))}
    </Page>
  )
}
