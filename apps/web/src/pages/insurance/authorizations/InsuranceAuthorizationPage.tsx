import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { NoteModal } from '@/components/insurer/NoteModal'
import { ModuleError } from '@/components/insurer/PagedView'
import { PageHeader } from '@/components/insurer/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatMoney, parseAmount } from '@/lib/insurerFormat'
import { formatShortDate, formatWhen } from '@/lib/format'
import {
  attachmentKindLabels,
  authorizationDeciderLabels,
  autoApprovalCheckLabels,
  autoApprovalReasonLabels,
  coverageReasonLabels,
  guideTypeLabels,
  insurerStatusLabel,
  insurerTimelineActorLabels,
  OVERRIDABLE_COVERAGE_REASONS,
  slaStatusLabels,
} from '@/lib/labels'
import { paths } from '@/routes/paths'
import { insurerAuthorizationsService } from '@/services/insurerAuthorizations.service'
import type { AuthorizationAssignee, InsurerAuthorizationAction, InsurerAuthorizationDetail } from '@/types/insurerAuthorizations'

/** Aviso sobre texto visível à clínica (C2: nunca dados clínicos; a clínica lê o motivo). */
const VISIBLE_WARNING = 'Escreva só o motivo administrativo. A clínica vai ler este texto.'

const dayEnd = (day: string) => `${day}T23:59:59.000Z`

function ApproveForm({ request, onClose, onDone }: { request: InsurerAuthorizationDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(String(request.requestedAmount).replace('.', ','))
  const [validUntil, setValidUntil] = useState('')
  const [note, setNote] = useState('')
  const [override, setOverride] = useState('')
  const needsOverride = OVERRIDABLE_COVERAGE_REASONS.includes(request.coverage.reason)

  async function submit() {
    const value = parseAmount(amount)
    if (value === null) return 'Indique o valor autorizado (maior que zero).'
    if (value > request.requestedAmount) return 'O valor autorizado não pode ser maior do que o pedido.'
    if (request.coverage.remaining != null && value > request.coverage.remaining) return 'O valor autorizado não pode ser maior do que o saldo disponível.'
    const partial = value < request.requestedAmount
    if (partial && !note.trim()) return 'Explique à clínica porque aprova só uma parte.'
    if (needsOverride && !override.trim()) return 'Indique a razão interna para aprovar apesar da carência ou do limite.'
    await insurerAuthorizationsService.approve(request.id, {
      ...(partial ? { authorizedAmount: value } : {}),
      ...(validUntil ? { validUntil: dayEnd(validUntil) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsOverride ? { overrideReason: override.trim() } : {}),
    })
    toast.show('Pedido aprovado.')
    return undefined
  }

  return (
    <FormModal
      title="Aprovar pedido"
      description={`${request.serviceName} · ${request.beneficiaryName}`}
      submitLabel="Aprovar"
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Este pedido já foi decidido ou está com outro analista.', VALIDATION_ERROR: 'Verifique os valores: o servidor não os aceitou.' }}
    >
      <Input label={`Valor autorizado (${request.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`A clínica pediu ${formatMoney(request.requestedAmount, request.currency)}.`} />
      <Input label="Válida até (opcional)" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} hint="Se não indicar, usa-se o prazo normal da seguradora." />
      <Textarea label="Nota para a clínica (obrigatória se aprovar só uma parte)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      <p className="text-sm text-muted">{VISIBLE_WARNING}</p>
      {needsOverride && (
        <Textarea
          label="Razão interna (a clínica não vê)"
          value={override}
          maxLength={200}
          onChange={(e) => setOverride(e.target.value)}
          hint={`Este pedido está ${request.coverage.reason === 'WAITING_PERIOD' ? 'em carência' : 'com o limite esgotado'}: aprová-lo é uma exceção que fica registada.`}
        />
      )}
    </FormModal>
  )
}

function AssignForm({ request, assignees, onClose, onDone }: { request: InsurerAuthorizationDetail; assignees: AuthorizationAssignee[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [analyst, setAnalyst] = useState(request.assignedTo?.id ?? '')
  async function submit() {
    if (!analyst) return 'Escolha um analista.'
    await insurerAuthorizationsService.assign(request.id, analyst)
    toast.show('Pedido atribuído.')
    return undefined
  }
  return (
    <FormModal title="Atribuir a um analista" description="Só o analista escolhido pode decidir este pedido." submitLabel="Atribuir" onClose={onClose} onSubmit={submit} onDone={onDone}>
      <Select label="Analista" value={analyst} onChange={(e) => setAnalyst(e.target.value)} placeholder="Escolher…" options={assignees.map((a) => ({ value: a.id, label: a.email }))} />
    </FormModal>
  )
}

type Dialog = 'approve' | 'reject' | 'info' | 'revert' | 'reopen' | 'assign' | null

/**
 * Pedido de autorização para decidir. Mostra só os botões que o servidor permite a este papel neste pedido (`allowedActions`).
 * A cobertura e o rasto da aprovação automática são internos: a clínica nunca os vê.
 */
export function InsuranceAuthorizationPage() {
  const { authorizationId = '' } = useParams()
  const toast = useToast()
  const { isSupervisor } = useInsuranceAuth()
  const [request, setRequest] = useState<InsurerAuthorizationDetail | null>(null)
  const [failed, setFailed] = useState<unknown>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [assignees, setAssignees] = useState<AuthorizationAssignee[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    insurerAuthorizationsService.get(authorizationId).then(
      (value) => {
        setRequest(value)
        setFailed(null)
      },
      (error: unknown) => setFailed(error),
    )
  }, [authorizationId])
  useEffect(load, [load])

  const can = (action: InsurerAuthorizationAction) => request?.allowedActions.includes(action) ?? false

  async function openAssign() {
    try {
      setAssignees(await insurerAuthorizationsService.assignees())
      setDialog('assign')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await run()
      toast.show(done)
    } catch (error) {
      toast.show(isAppError(error, 'CONFLICT') ? 'O pedido mudou entretanto. Atualizámos a página.' : errorMessage(error), 'error')
    } finally {
      setBusy(false)
      load()
    }
  }

  async function download(attachmentId: string, name: string) {
    try {
      const blob = await insurerAuthorizationsService.downloadAttachment(authorizationId, attachmentId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  if (failed) return <ModuleError error={failed} onRetry={load} />
  if (!request) return <LoadingState rows={4} />

  const status = insurerStatusLabel(request.status, request.closedReason)
  const sla = request.slaStatus ? slaStatusLabels[request.slaStatus] : null
  const done = () => {
    setDialog(null)
    load()
  }
  const backLink = (
    <Link to={paths.insuranceAuthorizations} className="inline-flex items-center gap-1 text-sm text-primary">
      <ArrowLeft className="size-4" aria-hidden /> Voltar às autorizações
    </Link>
  )

  return (
    <>
      {backLink}
      <PageHeader title={request.serviceName} description={`${request.beneficiaryName} · ${request.providerName}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        {request.isAppeal && <Badge tone="warning">Recurso</Badge>}
        {sla?.label && <Badge tone={sla.tone}>{sla.label}</Badge>}
        {request.escalatedAt && request.status === 'IN_REVIEW' && <Badge tone="danger">Avisado ao supervisor</Badge>}
        {request.expired && <Badge tone="neutral">Aprovação expirada</Badge>}
        {request.decidedBy && <Badge tone="neutral">{`Decidido por: ${authorizationDeciderLabels[request.decidedBy]?.toLowerCase() ?? ''}`}</Badge>}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Ações">
        {can('ASSIGN') && !isSupervisor && !request.assignedTo && (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void act(() => insurerAuthorizationsService.assign(request.id), 'Pedido atribuído a si.')}>
            Ficar com este pedido
          </Button>
        )}
        {isSupervisor && can('ASSIGN') && (
          <Button size="sm" variant="secondary" onClick={() => void openAssign()}>
            Atribuir a um analista
          </Button>
        )}
        {can('UNASSIGN') && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void act(() => insurerAuthorizationsService.assign(request.id, null), 'Pedido libertado.')}>
            Libertar pedido
          </Button>
        )}
        {can('APPROVE') && <Button size="sm" onClick={() => setDialog('approve')}>Aprovar</Button>}
        {can('REQUEST_INFO') && (
          <Button size="sm" variant="secondary" onClick={() => setDialog('info')}>
            Pedir informação
          </Button>
        )}
        {can('REJECT') && (
          <Button size="sm" variant="danger-ghost" onClick={() => setDialog('reject')}>
            Recusar
          </Button>
        )}
        {can('CANCEL') && (
          <Button size="sm" variant="danger-ghost" onClick={() => setDialog('revert')}>
            Reverter aprovação
          </Button>
        )}
        {can('REOPEN') && (
          <Button size="sm" variant="secondary" onClick={() => setDialog('reopen')}>
            Reabrir recusa
          </Button>
        )}
        {request.allowedActions.length === 0 && <p className="text-sm text-muted">Só pode consultar este pedido.</p>}
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">O pedido</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Valor pedido</dt><dd className="font-medium">{formatMoney(request.requestedAmount, request.currency)}</dd></div>
          <div><dt className="text-muted">Data prevista</dt><dd className="font-medium">{formatShortDate(request.expectedOn)}</dd></div>
          <div><dt className="text-muted">Tipo de guia</dt><dd className="font-medium">{guideTypeLabels[request.guideType]}</dd></div>
          <div><dt className="text-muted">Serviço</dt><dd className="font-medium">{request.serviceCode}</dd></div>
          {request.status === 'IN_REVIEW' && <div><dt className="text-muted">Responder até</dt><dd className="font-medium">{formatWhen(request.decisionDueAt)}</dd></div>}
          {request.assignedTo && <div><dt className="text-muted">Com o analista</dt><dd className="font-medium">{request.assignedTo.email}</dd></div>}
        </dl>
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{request.justification}</p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold">Cobertura do beneficiário (só para si)</h2>
        <p className="text-sm">
          <strong>{coverageReasonLabels[request.coverage.reason]}</strong>
          {request.coverage.requiresAuthorization ? ' · exige autorização' : ''} · a seguradora paga {request.coverage.copayPct} %
          {request.coverage.remaining != null && ` · saldo disponível ${formatMoney(request.coverage.remaining, request.currency)}`}
          {request.coverage.waitingEndsOn && ` · carência até ${formatShortDate(request.coverage.waitingEndsOn)}`}
        </p>
        <p className="text-sm text-muted">Esta informação não é mostrada à clínica nem à família.</p>
      </Card>

      {request.autoApproval && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Aprovação automática</h2>
          <p className="text-sm text-muted">
            {request.autoApproval.ok
              ? `Aprovado pela regra «${request.autoApproval.ruleName ?? ''}».`
              : 'Este pedido não foi aprovado automaticamente. Razões:'}
          </p>
          <ul className="flex flex-col gap-1 text-sm" aria-label="Verificações da aprovação automática">
            {request.autoApproval.checks.map((check) => (
              <li key={check.check} className="flex items-center gap-2">
                <Badge tone={check.ok ? 'success' : 'warning'}>{check.ok ? 'Cumpre' : 'Não cumpre'}</Badge>
                <span>
                  {autoApprovalCheckLabels[check.check]}
                  {!check.ok && ` — ${autoApprovalReasonLabels[check.reason]}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(request.decisionNote || request.code) && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Decisão</h2>
          {request.decisionNote && <p className="text-sm">{request.decisionNote}</p>}
          {request.status === 'APPROVED' && request.code && (
            <p className="text-sm">
              Código <strong>{request.code}</strong>
              {request.authorizedAmount != null && ` · autorizado ${formatMoney(request.authorizedAmount, request.currency)}${request.partial ? ' (em parte)' : ''}`}
              {request.validUntil && ` · válido até ${formatShortDate(request.validUntil)}`}
            </p>
          )}
        </Card>
      )}

      {request.attachments.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Documentos da clínica</h2>
          <ul className="divide-y divide-border">
            {request.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                <FileText className="size-4 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {attachmentKindLabels[a.kind]} · {a.originalName}
                </span>
                {can('DOWNLOAD_ATTACHMENT') && (
                  <Button size="sm" variant="ghost" onClick={() => void download(a.id, a.originalName)} icon={<Download className="size-4" aria-hidden />}>
                    Descarregar <span className="sr-only">{a.originalName}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold">Histórico</h2>
        <ol className="flex flex-col gap-2 text-sm" aria-label="Histórico do pedido">
          {request.timeline.map((entry, index) => (
            <li key={`${entry.occurredAt}-${index}`} className="flex flex-col">
              <span>
                <strong>{insurerStatusLabel(entry.status).label}</strong> · {insurerTimelineActorLabels[entry.by]} · {formatWhen(entry.occurredAt)}
              </span>
              {entry.note && <span className="text-muted">{entry.note}</span>}
              {entry.internalNote && (
                <span className="text-muted">
                  <Badge tone="neutral">Nota interna</Badge> {entry.internalNote}
                </span>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {dialog === 'approve' && <ApproveForm request={request} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'assign' && <AssignForm request={request} assignees={assignees} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'reject' && (
        <NoteModal
          title="Recusar pedido?"
          description={`${VISIBLE_WARNING} A clínica pode recorrer.`}
          noteLabel="Motivo da recusa (obrigatório)"
          confirmLabel="Recusar pedido"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={(note) => insurerAuthorizationsService.reject(request.id, note)}
          onDone={() => {
            toast.show('Pedido recusado.')
            done()
          }}
        />
      )}
      {dialog === 'info' && (
        <NoteModal
          title="Pedir informação à clínica"
          description={`${VISIBLE_WARNING} A clínica tem alguns dias para responder; se não responder, o pedido fecha.`}
          noteLabel="O que falta (obrigatório)"
          confirmLabel="Pedir informação"
          onClose={() => setDialog(null)}
          onConfirm={(note) => insurerAuthorizationsService.requestInfo(request.id, note)}
          onDone={() => {
            toast.show('Pedido de informação enviado.')
            done()
          }}
        />
      )}
      {dialog === 'revert' && (
        <NoteModal
          title="Reverter a aprovação?"
          description={`O código deixa de valer. ${VISIBLE_WARNING}`}
          noteLabel="Motivo (obrigatório)"
          confirmLabel="Reverter aprovação"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={(note) => insurerAuthorizationsService.cancel(request.id, note)}
          onDone={() => {
            toast.show('Aprovação revertida.')
            done()
          }}
        />
      )}
      {dialog === 'reopen' && (
        <NoteModal
          title="Reabrir a recusa?"
          description="O pedido volta à fila para outro analista decidir. Quem o recusou não volta a decidi-lo. O motivo é interno: a clínica não o vê."
          noteLabel="Motivo (obrigatório, interno)"
          confirmLabel="Reabrir pedido"
          onClose={() => setDialog(null)}
          onConfirm={(note) => insurerAuthorizationsService.reopen(request.id, note)}
          onDone={() => {
            toast.show('Pedido reaberto.')
            done()
          }}
        />
      )}
    </>
  )
}
