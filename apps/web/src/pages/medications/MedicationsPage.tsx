import { useState } from 'react'
import { Pill } from 'lucide-react'
import { MedicationList } from '@/components/domain/MedicationList'
import { Page } from '@/components/layout/Page'
import { ButtonLink } from '@/components/ui/Button'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { paths } from '@/routes/paths'
import { medicationService } from '@/services/medication.service'
import type { MedicationPlanStatus } from '@/types/medication'

const filters: ChipItem<MedicationPlanStatus>[] = [
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'ENDED', label: 'Terminados' },
]

/** Medicamentos ativos (UC-MED-02), com a próxima dose e o estado dos lembretes. */
export function MedicationsPage() {
  const { user, family, member } = useAuth()
  const [filter, setFilter] = useState<MedicationPlanStatus>('ACTIVE')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => medicationService.listMedications(familyId, userId), [familyId, userId])

  const items = state.status === 'success' ? state.data.filter((m) => m.plan.status === filter) : []

  return (
    <Page title="Medicamentos" backTo={paths.health} backLabel="Saúde">
      <FilterChips label="Filtrar medicamentos" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (items.length > 0 ? (
          <div>
            <MedicationList items={items} selfMemberId={member?.id} />
          </div>
        ) : filter === 'ACTIVE' ? (
          <EmptyState
            icon={Pill}
            title="Sem medicamentos ativos."
            description="Os medicamentos são criados a partir das receitas."
            action={<ButtonLink to={paths.prescriptionNew} size="xl">Adicionar receita</ButtonLink>}
          />
        ) : (
          <EmptyState icon={Pill} title="Sem medicamentos terminados." />
        ))}
    </Page>
  )
}
