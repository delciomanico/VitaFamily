import { useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import { PrescriptionList } from '@/components/domain/PrescriptionList'
import { Page } from '@/components/layout/Page'
import { ButtonLink } from '@/components/ui/Button'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { paths } from '@/routes/paths'
import { prescriptionService } from '@/services/prescription.service'

type Filter = 'ACTIVE' | 'HISTORY'

const filters: TabItem<Filter>[] = [
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'HISTORY', label: 'Histórico' },
]

const addIcon = <Plus className="size-4" aria-hidden />

export function PrescriptionsPage() {
  const { user, family, member } = useAuth()
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => prescriptionService.listPrescriptions(familyId, userId), [familyId, userId])

  const items =
    state.status === 'success'
      ? state.data.filter((r) => (filter === 'ACTIVE') === (r.prescription.status === 'ACTIVE'))
      : []

  return (
    <Page
      title="Receitas"
      backTo={paths.health}
      backLabel="Saúde"
      action={
        <ButtonLink to={paths.prescriptionNew} size="sm" icon={addIcon}>
          Adicionar
        </ButtonLink>
      }
    >
      <Tabs label="Filtrar receitas" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (items.length > 0 ? (
          <div role="tabpanel">
            <PrescriptionList items={items} selfMemberId={member?.id} />
          </div>
        ) : filter === 'ACTIVE' ? (
          <EmptyState
            icon={FileText}
            title="Ainda não existem receitas."
            description="Registe uma receita para acompanhar os medicamentos e os horários."
            action={
              <ButtonLink to={paths.prescriptionNew} icon={addIcon}>
                Adicionar receita
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="Sem receitas anteriores."
            description="Receitas concluídas ou canceladas aparecem aqui."
          />
        ))}
    </Page>
  )
}
