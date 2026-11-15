import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/insurer/PageHeader'
import { ModuleError, PagedView } from '@/components/insurer/PagedView'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState, LoadingState } from '@/components/ui/states'
import { usePagedList } from '@/hooks/usePagedList'
import { formatMoney, formatPercent } from '@/lib/insurerFormat'
import { formatShortDate, formatWhen } from '@/lib/format'
import { authorizationDeciderLabels, insurerStatusLabel, slaStatusLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { insurerAuthorizationsService } from '@/services/insurerAuthorizations.service'
import type { AuthorizationSlaMetrics, InsurerAuthorization, InsurerAuthorizationQuery } from '@/types/insurerAuthorizations'

type View = 'open' | 'mine' | 'unassigned' | 'appeals' | 'escalated' | 'approved' | 'rejected'

const VIEWS: Array<{ value: View; label: string; query: InsurerAuthorizationQuery }> = [
  { value: 'open', label: 'Por decidir', query: { status: 'OPEN' } },
  { value: 'mine', label: 'Meus', query: { status: 'OPEN', assigned: 'ME' } },
  { value: 'unassigned', label: 'Sem analista', query: { status: 'OPEN', assigned: 'UNASSIGNED' } },
  { value: 'appeals', label: 'Recursos', query: { status: 'OPEN', appeal: true } },
  { value: 'escalated', label: 'Prazo ultrapassado', query: { status: 'OPEN', escalated: true } },
  { value: 'approved', label: 'Aprovados', query: { status: 'APPROVED', sort: 'RECENT' } },
  { value: 'rejected', label: 'Recusados', query: { status: 'REJECTED', sort: 'RECENT' } },
]

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' }) {
  return (
    <div className="flex flex-col rounded-lg bg-surface-muted px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={tone === 'danger' && Number(value) > 0 ? 'text-lg font-semibold text-danger' : 'text-lg font-semibold'}>{value}</dd>
    </div>
  )
}

/** Retrato do trabalho em curso e do cumprimento dos prazos (só números, sem dados de pessoas). */
function Summary() {
  const [metrics, setMetrics] = useState<AuthorizationSlaMetrics | null>(null)
  const [failed, setFailed] = useState<unknown>(null)
  useEffect(() => {
    let active = true
    insurerAuthorizationsService.metrics().then(
      (value) => active && setMetrics(value),
      (error: unknown) => active && setFailed(error),
    )
    return () => {
      active = false
    }
  }, [])
  if (failed) return <ModuleError error={failed} />
  if (!metrics) return <LoadingState rows={1} />
  const { open, period } = metrics
  return (
    <Card className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Pedidos em curso">
        <Stat label="Por decidir" value={open.total} />
        <Stat label="Sem analista" value={open.unassigned} />
        <Stat label="Prazo ultrapassado" value={open.overdue} tone="danger" />
        <Stat label="Avisados ao supervisor" value={open.escalated} tone="danger" />
        <Stat label="À espera da clínica" value={open.infoRequested} />
      </dl>
      <p className="text-sm text-muted">
        Últimos 30 dias: {period.decided} {period.decided === 1 ? 'decisão' : 'decisões'}
        {period.slaMetPct != null && ` · ${formatPercent(period.slaMetPct)} dentro do prazo`}
        {period.autoApprovedPct != null && ` · ${formatPercent(period.autoApprovedPct)} aprovadas automaticamente`}
        {period.medianDecisionHours != null && ` · tempo mediano ${Math.round(period.medianDecisionHours)} h`}.
      </p>
    </Card>
  )
}

function Row({ request }: { request: InsurerAuthorization }) {
  const status = insurerStatusLabel(request.status, request.closedReason)
  const sla = request.slaStatus ? slaStatusLabels[request.slaStatus] : null
  return (
    <Link to={paths.insuranceAuthorization(request.id)} className="flex flex-col gap-1.5 py-3 hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.serviceName}</span>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        {request.isAppeal && <Badge tone="warning">Recurso</Badge>}
        {request.decidedBy === 'SYSTEM' && <Badge tone="primary">Aprovado pelas regras</Badge>}
        {sla && sla.label && request.status === 'IN_REVIEW' && <Badge tone={sla.tone}>{sla.label}</Badge>}
        {request.escalatedAt && request.status === 'IN_REVIEW' && <Badge tone="danger">Avisado ao supervisor</Badge>}
      </span>
      <span className="text-sm text-muted">
        {request.beneficiaryName} · {request.providerName} · {formatMoney(request.requestedAmount, request.currency)} · data prevista {formatShortDate(request.expectedOn)}
      </span>
      <span className="text-sm text-muted">
        {request.status === 'IN_REVIEW' ? `Responder até ${formatWhen(request.decisionDueAt)}` : `Atualizado ${formatWhen(request.updatedAt)}`}
        {request.assignedTo ? ` · com ${request.assignedTo.email}` : request.status === 'IN_REVIEW' && !request.isAppeal ? ' · sem analista' : ''}
        {request.decidedBy && request.decidedBy !== 'SYSTEM' ? ` · decidido por ${authorizationDeciderLabels[request.decidedBy]?.toLowerCase() ?? ''}` : ''}
      </span>
    </Link>
  )
}

/**
 * Fila de autorizações da seguradora (BR-AUT-19): o mais atrasado primeiro. Todos os papéis do módulo com leitura veem a fila; quais
 * ações cada um tem em cada pedido vem do servidor (`allowedActions`). O prazo só informa: nunca aprova nem recusa sozinho.
 */
export function InsuranceAuthorizationsPage() {
  const [view, setView] = useState<View>('open')
  const current = VIEWS.find((v) => v.value === view) ?? VIEWS[0]!
  const list = usePagedList((cursor) => insurerAuthorizationsService.list({ ...current.query, ...(cursor ? { cursor } : {}) }), [view])

  return (
    <>
      <PageHeader
        title="Autorizações"
        description="Pedidos das clínicas, do mais urgente para o menos urgente. O prazo serve de aviso: um pedido nunca é aprovado nem recusado sem decisão de uma pessoa."
      />
      <Summary />
      <Tabs label="Ver pedidos" items={VIEWS.map(({ value, label }) => ({ value, label }))} value={view} onChange={setView} scrollable />
      <PagedView list={list} empty={<EmptyState icon={ShieldCheck} title="Sem pedidos aqui." description={view === 'open' ? 'Não há pedidos por decidir.' : undefined} />}>
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((request) => (
              <Row key={request.id} request={request} />
            ))}
          </Card>
        )}
      </PagedView>
    </>
  )
}
