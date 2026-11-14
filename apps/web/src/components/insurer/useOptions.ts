import { useAsync } from '@/hooks/useAsync'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { SelectOption } from '@/components/ui/Select'

/** Empresas ativas para os selects (até 100; a listagem completa tem a sua página). */
export function useCompanyOptions() {
  const { state } = useAsync(() => insurerOpsService.listCompanies({ limit: 100, status: 'ACTIVE' }), [])
  const options: SelectOption[] = state.status === 'success' ? state.data.items.map((c) => ({ value: c.id, label: c.name })) : []
  return options
}
