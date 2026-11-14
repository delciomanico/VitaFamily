import { useState, type FormEvent } from 'react'
import { FileText, Plus, Search } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { NoteModal } from '@/components/insurer/NoteModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { HolderSelect } from '@/components/insurer/HolderSelect'
import { useCompanyOptions } from '@/components/insurer/useOptions'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { withFallback } from '@/lib/safe'
import { insurerOpsService } from '@/services/insurerOps.service'
import { policyStatusLabel, type InsurerPolicy, type PolicyStatus } from '@/types/insurerOps'

const statusTone = withFallback<PolicyStatus, Tone>(
  { DRAFT: 'neutral', ACTIVE: 'success', SUSPENDED: 'warning', EXPIRED: 'neutral', CANCELLED: 'danger' },
  () => 'neutral',
)
const statusText = withFallback(policyStatusLabel, (key) => key)

const STATUS_FILTERS = (Object.keys(policyStatusLabel) as PolicyStatus[]).map((value) => ({ value, label: policyStatusLabel[value] }))

/** ST Policy: DRAFT→ACTIVE, ACTIVE⇄SUSPENDED, →CANCELLED; EXPIRED é só do job (UC-SEG-03). */
function allowedActions(status: PolicyStatus): Array<'ACTIVE' | 'SUSPENDED' | 'CANCELLED'> {
  if (status === 'DRAFT') return ['ACTIVE', 'CANCELLED']
  if (status === 'ACTIVE') return ['SUSPENDED', 'CANCELLED']
  if (status === 'SUSPENDED') return ['ACTIVE', 'CANCELLED']
  return []
}
const actionLabel = { ACTIVE: 'Ativar', SUSPENDED: 'Suspender', CANCELLED: 'Cancelar' } as const

function PolicyForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [number, setNumber] = useState('')
  const [planId, setPlanId] = useState('')
  const [holderId, setHolderId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const toast = useToast()
  const companies = useCompanyOptions()
  // Só planos ativos aceitam apólices novas (UC-SEG-04); a ativação da apólice exige plano ACTIVE.
  const { state } = useAsync(() => insurerOpsService.listPlans({ limit: 100, status: 'ACTIVE' }), [])
  const plans = state.status === 'success' ? state.data.items.map((p) => ({ value: p.id, label: `${p.name} (v${p.version})` })) : []

  async function submit() {
    if (!number.trim()) return 'Indique o número da apólice.'
    if (!planId) return 'Escolha o plano.'
    if (!holderId) return 'Escolha o titular.'
    if (!validFrom || !validTo) return 'Indique o início e o fim da validade.'
    if (validFrom > validTo) return 'O início não pode ser depois do fim.'
    await insurerOpsService.createPolicy({
      number: number.trim(),
      planId,
      holderId,
      validFrom,
      validTo,
      ...(companyId ? { companyId } : {}),
    })
    toast.show('Apólice criada como rascunho.')
    return undefined
  }

  return (
    <FormModal
      title="Nova apólice"
      description="Nasce como rascunho; ative-a quando estiver pronta."
      submitLabel="Criar apólice"
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe uma apólice com este número.' }}
    >
      <Input label="Número da apólice" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
      <Select label="Plano" value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="Escolher plano" options={plans} />
      <HolderSelect value={holderId} onChange={setHolderId} />
      <Select label="Empresa (opcional)" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Sem empresa" options={companies} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Válida desde" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <Input label="Válida até" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </div>
    </FormModal>
  )
}

/** Apólices (UC-SEG-03): filtros por estado e número, criação e mudança de estado com nota. */
export function InsurancePoliciesPage() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [applied, setApplied] = useState({ q: '', status: '' })
  const list = usePagedList((cursor) => insurerOpsService.listPolicies({ q: applied.q, status: applied.status, cursor }), [applied])
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<{ policy: InsurerPolicy; to: 'SUSPENDED' | 'CANCELLED' } | null>(null)

  function search(event: FormEvent) {
    event.preventDefault()
    setApplied({ q: q.trim(), status })
  }

  async function activate(policy: InsurerPolicy) {
    try {
      await insurerOpsService.setPolicyStatus(policy.id, 'ACTIVE')
      toast.show(`Apólice ${policy.number} ativa.`)
    } catch (error) {
      toast.show(
        isAppError(error, 'CONFLICT') ? 'Não foi possível ativar: o plano da apólice tem de estar ativo.' : errorMessage(error),
        'error',
      )
    }
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Apólices"
        action={
          <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
            Nova apólice
          </Button>
        }
      />
      <form onSubmit={search} role="search" aria-label="Pesquisar apólices" className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Input label="Número da apólice" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select label="Estado" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todos" options={STATUS_FILTERS} />
        <Button type="submit" variant="secondary" className="sm:mb-6">
          Pesquisar
        </Button>
      </form>
      <PagedView list={list} empty={<EmptyState icon={FileText} title="Sem apólices." description="Crie um plano ativo e depois a primeira apólice." />}>
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.number}</span>
                  <Badge tone={statusTone[p.status]} dot>
                    {statusText[p.status]}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  {p.planName} (v{p.planVersion}) · {formatShortDate(p.validFrom)} a {formatShortDate(p.validTo)}
                </p>
                {p.statusNote && <p className="text-sm text-muted">Nota: {p.statusNote}</p>}
                <div className="flex flex-wrap gap-2">
                  {allowedActions(p.status).map((to) => (
                    <Button
                      key={to}
                      size="sm"
                      variant={to === 'CANCELLED' ? 'danger-ghost' : 'ghost'}
                      onClick={() => (to === 'ACTIVE' ? void activate(p) : setPending({ policy: p, to }))}
                    >
                      {actionLabel[to]} <span className="sr-only">apólice {p.number}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {creating && (
        <PolicyForm
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
      {pending && (
        <NoteModal
          title={pending.to === 'CANCELLED' ? 'Cancelar apólice?' : 'Suspender apólice?'}
          description={`Apólice ${pending.policy.number}. Os beneficiários deixam de ser elegíveis por ela.`}
          noteLabel="Motivo (obrigatório)"
          confirmLabel={pending.to === 'CANCELLED' ? 'Cancelar apólice' : 'Suspender'}
          destructive
          onClose={() => setPending(null)}
          onConfirm={(note) => insurerOpsService.setPolicyStatus(pending.policy.id, pending.to, note)}
          onDone={() => {
            toast.show(pending.to === 'CANCELLED' ? 'Apólice cancelada.' : 'Apólice suspensa.')
            setPending(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}
