import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ModuleError } from '@/components/insurer/PagedView'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatDays, formatMoney, formatPercent } from '@/lib/insurerFormat'
import { paths } from '@/routes/paths'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { InsurerPlan, InsurerPlanCoverage, InsurerPlanCoverageInput, InsurerService } from '@/types/insurerOps'
import { planText, planTone } from './InsurancePlansPage'
import { PageHeader } from '@/components/insurer/PageHeader'
import { ClipboardCheck } from 'lucide-react'

type Mode = 'none' | 'covered' | 'excluded'

interface Row {
  mode: Mode
  copayPct: string
  limitPerYear: string
  waitingDays: string
  requiresAuthorization: boolean
}

const blankRow: Row = { mode: 'none', copayPct: '100', limitPerYear: '', waitingDays: '0', requiresAuthorization: false }

function toRow(c: InsurerPlanCoverage): Row {
  return {
    mode: c.covered ? 'covered' : 'excluded',
    copayPct: String(c.copayPct),
    limitPerYear: c.limitPerYear == null ? '' : String(c.limitPerYear),
    waitingDays: String(c.waitingDays),
    requiresAuthorization: c.requiresAuthorization,
  }
}

/** Leitura das coberturas (todos os papéis do módulo). */
function CoverageTable({ coverages }: { coverages: InsurerPlanCoverage[] }) {
  const { currency } = useInsuranceAuth()
  if (coverages.length === 0) {
    return <EmptyState icon={ClipboardCheck} title="Sem coberturas definidas." description="Um serviço ausente do plano não é coberto." />
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <caption className="sr-only">Coberturas do plano (valores em {currency})</caption>
        <thead className="bg-surface-muted text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Serviço</th>
            <th scope="col" className="px-3 py-2 font-medium">Cobertura</th>
            <th scope="col" className="px-3 py-2 font-medium">Seguradora paga</th>
            <th scope="col" className="px-3 py-2 font-medium">Teto anual</th>
            <th scope="col" className="px-3 py-2 font-medium">Carência</th>
            <th scope="col" className="px-3 py-2 font-medium">Autorização</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {coverages.map((c) => (
            <tr key={c.serviceId}>
              <th scope="row" className="px-3 py-2 font-medium">
                {c.serviceName} <span className="font-normal text-muted">({c.serviceCode})</span>
              </th>
              <td className="px-3 py-2">{c.covered ? 'Coberto' : 'Excluído'}</td>
              <td className="px-3 py-2">{c.covered ? formatPercent(c.copayPct) : '—'}</td>
              <td className="px-3 py-2">{c.covered && c.limitPerYear != null ? formatMoney(c.limitPerYear, currency) : '—'}</td>
              <td className="px-3 py-2">{c.covered && c.waitingDays > 0 ? formatDays(c.waitingDays) : '—'}</td>
              <td className="px-3 py-2">{c.covered && c.requiresAuthorization ? 'Exige' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Editor do conjunto inteiro de coberturas (PUT substitui tudo; só em plano DRAFT, BR-SEG-02/04/09/22). */
function CoverageEditor({
  planId,
  services,
  current,
  onSaved,
}: {
  planId: string
  services: InsurerService[]
  current: InsurerPlanCoverage[]
  onSaved: () => void
}) {
  const toast = useToast()
  const { currency } = useInsuranceAuth()
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(current.map((c) => [c.serviceId, toRow(c)])))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const patch = (serviceId: string, change: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [serviceId]: { ...(prev[serviceId] ?? blankRow), ...change } }))

  async function save() {
    const items: InsurerPlanCoverageInput[] = []
    for (const service of services) {
      const row = rows[service.id]
      if (!row || row.mode === 'none') continue
      const copay = Number(row.copayPct)
      const waiting = Number(row.waitingDays)
      const limit = row.limitPerYear.trim() === '' ? null : Number(row.limitPerYear)
      if (!Number.isFinite(copay) || copay < 0 || copay > 100) return setError(`${service.name}: a percentagem paga deve estar entre 0 e 100.`)
      if (!Number.isInteger(waiting) || waiting < 0) return setError(`${service.name}: a carência deve ser um número inteiro de dias (0 ou mais).`)
      if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return setError(`${service.name}: o teto anual deve ser 0 ou mais.`)
      items.push({
        serviceId: service.id,
        covered: row.mode === 'covered',
        copayPct: copay,
        limitPerYear: limit,
        waitingDays: waiting,
        requiresAuthorization: row.requiresAuthorization,
      })
    }
    setSaving(true)
    setError(null)
    try {
      await insurerOpsService.replacePlanCoverages(planId, items)
      toast.show('Coberturas guardadas.')
      onSaved()
    } catch (err) {
      setError(isAppError(err, 'CONFLICT') ? 'Só um plano em rascunho aceita alterações.' : errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (services.length === 0) {
    return <EmptyState icon={ClipboardCheck} title="Sem serviços ativos." description="Crie serviços na página Serviços para os poder cobrir." />
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Defina o que o plano cobre. Serviços «Não incluído» ficam fora do plano (não cobertos). Valores em {currency}.
      </p>
      {services.map((s) => {
        const row = rows[s.id] ?? blankRow
        const active = row.mode === 'covered'
        return (
          <Card key={s.id} className="flex flex-col gap-3" role="group" aria-label={`Cobertura de ${s.name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {s.name} <span className="font-normal text-muted">({s.code})</span>
              </span>
              <div className="w-44">
                <Select
                  label="Cobertura"
                  value={row.mode}
                  onChange={(e) => patch(s.id, { mode: e.target.value as Mode })}
                  options={[
                    { value: 'none', label: 'Não incluído' },
                    { value: 'covered', label: 'Coberto' },
                    { value: 'excluded', label: 'Excluído' },
                  ]}
                />
              </div>
            </div>
            {active && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Input label="% paga pela seguradora" type="number" min={0} max={100} step="any" value={row.copayPct} onChange={(e) => patch(s.id, { copayPct: e.target.value })} />
                <Input label={`Teto anual (${currency})`} type="number" min={0} step="any" value={row.limitPerYear} hint="Vazio = sem teto" onChange={(e) => patch(s.id, { limitPerYear: e.target.value })} />
                <Input label="Carência (dias)" type="number" min={0} step={1} value={row.waitingDays} onChange={(e) => patch(s.id, { waitingDays: e.target.value })} />
                <div className="col-span-2 sm:col-span-3">
                  <Checkbox label="Exige autorização prévia" checked={row.requiresAuthorization} onChange={(e) => patch(s.id, { requiresAuthorization: e.target.checked })} />
                </div>
              </div>
            )}
          </Card>
        )
      })}
      <FormError message={error} />
      <Button onClick={() => void save()} loading={saving} className="self-start">
        Guardar coberturas
      </Button>
    </div>
  )
}

/** Plano: estado, ativar/arquivar (Admin) e coberturas (editáveis só em rascunho). */
export function InsurancePlanPage() {
  const { planId = '' } = useParams()
  const { isAdmin } = useInsuranceAuth()
  const toast = useToast()
  const plan = useAsync(() => insurerOpsService.getPlan(planId), [planId])
  const coverages = useAsync(() => insurerOpsService.listPlanCoverages(planId), [planId])
  const [services, setServices] = useState<InsurerService[]>([])
  const [confirm, setConfirm] = useState<'ACTIVE' | 'ARCHIVED' | null>(null)
  const [busy, setBusy] = useState(false)
  const draft = plan.state.status === 'success' && plan.state.data.status === 'DRAFT'

  // Serviços ativos (até 100) para o editor; só se carrega quando há edição possível.
  useEffect(() => {
    if (!isAdmin || !draft) return
    let active = true
    insurerOpsService.listServices({ limit: 100, status: 'ACTIVE' }).then(
      (page) => active && setServices(page.items),
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [isAdmin, draft])

  async function changeStatus() {
    if (!confirm) return
    setBusy(true)
    try {
      await insurerOpsService.setPlanStatus(planId, confirm)
      toast.show(confirm === 'ACTIVE' ? 'Plano ativado.' : 'Plano arquivado.')
    } catch (error) {
      toast.show(
        isAppError(error, 'CONFLICT') ? 'Não foi possível: um plano só se ativa com pelo menos uma cobertura.' : errorMessage(error),
        'error',
      )
    } finally {
      setBusy(false)
      setConfirm(null)
      plan.reload()
    }
  }

  const back = (
    <ButtonLink to={paths.insurancePlans} variant="ghost" size="sm">
      Voltar aos planos
    </ButtonLink>
  )

  if (plan.state.status === 'loading' || coverages.state.status === 'loading') return <LoadingState rows={3} />
  if (plan.state.status === 'error') return <><ModuleError error={plan.state.error} onRetry={plan.reload} />{back}</>
  if (coverages.state.status === 'error') return <><ModuleError error={coverages.state.error} onRetry={coverages.reload} />{back}</>

  const data: InsurerPlan = plan.state.data
  const rows = coverages.state.data

  return (
    <ErrorBoundary>
      <PageHeader
        title={`${data.name} · versão ${data.version}`}
        action={
          <Badge tone={planTone[data.status]} dot>
            {planText[data.status]}
          </Badge>
        }
      />
      <div className="flex flex-wrap gap-2">
        {back}
        {isAdmin && data.status === 'DRAFT' && (
          <Button size="sm" onClick={() => setConfirm('ACTIVE')} disabled={data.coverageCount < 1}>
            Ativar plano
          </Button>
        )}
        {isAdmin && data.status === 'ACTIVE' && (
          <Button size="sm" variant="danger-ghost" onClick={() => setConfirm('ARCHIVED')}>
            Arquivar plano
          </Button>
        )}
      </div>
      {isAdmin && data.status === 'DRAFT' && data.coverageCount < 1 && (
        <p className="text-sm text-muted">Guarde pelo menos uma cobertura para poder ativar o plano.</p>
      )}

      {isAdmin && data.status === 'DRAFT' ? (
        <CoverageEditor
          planId={planId}
          services={services}
          current={rows}
          onSaved={() => {
            plan.reload()
            coverages.reload()
          }}
        />
      ) : (
        <>
          {data.status !== 'DRAFT' && (
            <p className="text-sm text-muted">Este plano não se edita; para alterar as coberturas crie uma nova versão.</p>
          )}
          <CoverageTable coverages={rows} />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'ACTIVE' ? 'Ativar este plano?' : 'Arquivar este plano?'}
        description={
          confirm === 'ACTIVE'
            ? 'Depois de ativo, o plano e as suas coberturas deixam de se editar (cria-se uma nova versão).'
            : 'O plano deixa de aceitar apólices novas; as existentes mantêm-se.'
        }
        confirmLabel={confirm === 'ACTIVE' ? 'Ativar' : 'Arquivar'}
        destructive={confirm === 'ARCHIVED'}
        loading={busy}
        onConfirm={() => void changeStatus()}
        onCancel={() => setConfirm(null)}
      />
    </ErrorBoundary>
  )
}
