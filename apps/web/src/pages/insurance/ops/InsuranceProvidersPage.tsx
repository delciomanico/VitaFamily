import { useState } from 'react'
import { Hospital, Plus } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage } from '@/lib/errors'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { InsurerProvider } from '@/types/insurerOps'

function ProviderForm({ linkedClinicIds, onClose, onDone }: { linkedClinicIds: string[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [clinicId, setClinicId] = useState('')
  const toast = useToast()
  // Escolhe-se numa lista de clínicas parceiras (decisão do proprietário, 2026-11-11): só `id` e nome.
  const { state } = useAsync(() => insurerOpsService.listPartnerClinics({ q: q.trim(), limit: 50 }), [q])
  const options =
    state.status === 'success'
      ? state.data.items.map((c) => ({ value: c.id, label: linkedClinicIds.includes(c.id) ? `${c.name} (já ligada)` : c.name }))
      : []

  return (
    <FormModal
      title="Ligar clínica"
      description="Só as clínicas ligadas podem validar os seus beneficiários. A ligação pode ser suspensa a qualquer momento."
      submitLabel="Ligar clínica"
      onClose={onClose}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Esta clínica já está ligada.', NOT_FOUND: 'Esta clínica já não está disponível.' }}
      onSubmit={async () => {
        if (!clinicId) return 'Escolha uma clínica.'
        if (linkedClinicIds.includes(clinicId)) return 'Esta clínica já está ligada.'
        await insurerOpsService.createProvider(clinicId)
        toast.show('Clínica ligada.')
        return undefined
      }}
    >
      <Input label="Pesquisar clínica" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select label="Clínica parceira" value={clinicId} onChange={(e) => setClinicId(e.target.value)} placeholder="Escolher clínica" options={options} />
      {state.status === 'success' && options.length === 0 && <p className="text-sm text-muted">Nenhuma clínica parceira encontrada.</p>}
    </FormModal>
  )
}

/** Clínicas ligadas à seguradora (Admin): ligar a partir das clínicas parceiras, suspender e reativar. */
export function InsuranceProvidersPage() {
  const toast = useToast()
  const list = usePagedList((cursor) => insurerOpsService.listProviders({ cursor }), [])
  const [creating, setCreating] = useState(false)

  async function toggle(provider: InsurerProvider) {
    try {
      await insurerOpsService.setProviderStatus(provider.id, provider.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
      toast.show(provider.status === 'ACTIVE' ? 'Ligação suspensa.' : 'Ligação reativada.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Clínicas ligadas"
        description="Só as clínicas ligadas veem esta seguradora e podem validar a cobertura de um beneficiário."
        action={
          <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
            Ligar clínica
          </Button>
        }
      />
      <PagedView list={list} empty={<EmptyState icon={Hospital} title="Nenhuma clínica ligada." description="Ligue uma clínica parceira para ela poder validar beneficiários." />}>
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <Badge tone={p.status === 'ACTIVE' ? 'success' : 'warning'} dot>
                  {p.status === 'ACTIVE' ? 'Ligada' : 'Suspensa'}
                </Badge>
                <Button size="sm" variant={p.status === 'ACTIVE' ? 'danger-ghost' : 'ghost'} onClick={() => void toggle(p)}>
                  {p.status === 'ACTIVE' ? 'Suspender' : 'Reativar'} <span className="sr-only">{p.name}</span>
                </Button>
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {creating && (
        <ProviderForm
          linkedClinicIds={list.items.flatMap((p) => (p.clinicId ? [p.clinicId] : []))}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
    </>
  )
}
