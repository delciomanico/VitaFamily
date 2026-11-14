import { useRef, useState } from 'react'
import { Paperclip, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { attachmentErrorMessage, errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { formatMoney } from '@/lib/insurerFormat'
import { attachmentKindLabels, authorizationStatus, guideTypeLabels } from '@/lib/labels'
import { clinicAuthorizationsService } from '@/services/clinicAuthorizations.service'
import type { AuthorizationAttachmentKind, AuthorizationRequest } from '@/types/insurerOps'
import { JUSTIFICATION_MAX, NO_CLINICAL_HINT } from './RequestAuthorizationWizard'

const KIND_OPTIONS = (Object.keys(attachmentKindLabels) as AuthorizationAttachmentKind[]).map((value) => ({ value, label: attachmentKindLabels[value] }))
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })

interface Props {
  authorizationId: string
  onClose: () => void
  /** Algo mudou (estado, anexos, recurso): a lista recarrega. */
  onChanged: () => void
}

/**
 * Detalhe de um pedido: estado, motivo da decisão, linha do tempo e SÓ as ações que o servidor permite (`allowedActions`):
 * responder a «falta informação», cancelar, recorrer e anexar (administrativos, BR-AUT-13).
 */
export function AuthorizationDetailModal({ authorizationId, onClose, onChanged }: Props) {
  const detail = useAsync(() => clinicAuthorizationsService.get(authorizationId), [authorizationId])
  const [reply, setReply] = useState('')
  const [mode, setMode] = useState<'respond' | 'appeal' | null>(null)
  const [kind, setKind] = useState<AuthorizationAttachmentKind>('QUOTE')
  const [confirm, setConfirm] = useState<{ kind: 'cancel' } | { kind: 'remove'; id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function run(action: () => Promise<unknown>, after?: () => void, describe: (err: unknown) => string = errorMessage) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
      after?.()
      detail.reload()
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  const request: AuthorizationRequest | null = detail.state.status === 'success' ? detail.state.data : null
  const can = (action: AuthorizationRequest['allowedActions'][number]) => request?.allowedActions.includes(action) ?? false
  const status = request ? authorizationStatus[request.status] : null

  return (
    <Modal open onClose={onClose} title={request ? request.serviceName : 'Pedido de autorização'} description={request?.beneficiaryName}>
      {detail.state.status === 'loading' && <LoadingState rows={3} />}
      {detail.state.status === 'error' && <ErrorState onRetry={detail.reload} />}
      {request && status && (
        <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={status.tone}>{status.label}</Badge>
            {request.status === 'IN_REVIEW' && request.decisionDueAt && <span className="text-muted">Resposta até {formatShortDate(request.decisionDueAt)}</span>}
            {request.status === 'INFO_REQUESTED' && request.infoExpiresAt && <span className="text-muted">Responda até {formatShortDate(request.infoExpiresAt)}</span>}
            {request.status === 'REJECTED' && request.appealOpenUntil && <span className="text-muted">Pode recorrer até {formatShortDate(request.appealOpenUntil)}</span>}
            {request.closedReason === 'INFO_TIMEOUT' && <span className="text-muted">Fechado por falta de resposta.</span>}
          </p>
          {request.decisionNote && <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{request.decisionNote}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Seguradora</dt><dd className="font-medium">{request.insurerName}</dd></div>
            <div><dt className="text-muted">Tipo de guia</dt><dd className="font-medium">{guideTypeLabels[request.guideType]}</dd></div>
            <div><dt className="text-muted">Valor pedido</dt><dd className="font-medium">{formatMoney(request.requestedAmount, request.currency)}</dd></div>
            <div><dt className="text-muted">Data prevista</dt><dd className="font-medium">{formatShortDate(request.expectedOn)}</dd></div>
            {request.status === 'APPROVED' && (
              <>
                <div><dt className="text-muted">Código de autorização</dt><dd className="font-medium">{request.code}</dd></div>
                <div>
                  <dt className="text-muted">Valor autorizado{request.partial ? ' (em parte)' : ''}</dt>
                  <dd className="font-medium">{formatMoney(request.authorizedAmount ?? 0, request.currency)}</dd>
                </div>
              </>
            )}
          </dl>
          <p className="text-sm"><span className="text-muted">Justificação: </span>{request.justification}</p>

          {request.timeline && request.timeline.length > 0 && (
            <ol aria-label="Histórico" className="flex flex-col gap-1 text-sm">
              {request.timeline.map((entry, index) => (
                <li key={index}>
                  <span className="text-muted">{dateTime(entry.occurredAt)} · </span>
                  {authorizationStatus[entry.status].label}
                  {entry.note ? ` — ${entry.note}` : ''}
                </li>
              ))}
            </ol>
          )}

          {(request.attachments ?? []).length > 0 && (
            <ul aria-label="Anexos" className="flex flex-col gap-1 text-sm">
              {(request.attachments ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span><Paperclip className="mr-1 inline size-4" aria-hidden />{attachmentKindLabels[a.kind]} · {a.originalName}</span>
                  {can('ATTACH') && (
                    <Button variant="danger-ghost" aria-label={`Remover ${a.originalName}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirm({ kind: 'remove', id: a.id, name: a.originalName })}>
                      Remover
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {can('ATTACH') && (
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Tipo de documento" value={kind} onChange={(e) => setKind(e.target.value as AuthorizationAttachmentKind)} options={KIND_OPTIONS} />
              <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" aria-label="Ficheiro a anexar" className="min-h-11 text-sm" />
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => {
                  const file = fileInput.current?.files?.[0]
                  if (!file) return setError('Escolha um ficheiro PDF, JPG ou PNG.')
                  void run(
                    () => clinicAuthorizationsService.attach(request.id, { kind, file }),
                    () => {
                      if (fileInput.current) fileInput.current.value = ''
                    },
                    attachmentErrorMessage,
                  )
                }}
              >
                Anexar
              </Button>
              <p className="w-full text-xs text-muted">{NO_CLINICAL_HINT} Só documentos administrativos (PDF, JPG ou PNG, até 10 MB).</p>
            </div>
          )}

          {mode !== null && (
            <div className="flex flex-col gap-2">
              <Textarea
                label={mode === 'respond' ? 'A sua resposta' : 'Porque pede nova análise'}
                maxLength={JUSTIFICATION_MAX}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                hint={`${NO_CLINICAL_HINT} Só informação administrativa.`}
              />
              <div className="flex gap-2">
                <Button
                  loading={busy}
                  onClick={() => {
                    if (!reply.trim()) return setError('Escreva uma mensagem.')
                    void run(
                      () => (mode === 'respond' ? clinicAuthorizationsService.respond(request.id, reply.trim()) : clinicAuthorizationsService.appeal(request.id, { justification: reply.trim() })),
                      () => {
                        setMode(null)
                        setReply('')
                      },
                    )
                  }}
                >
                  {mode === 'respond' ? 'Enviar resposta' : 'Pedir nova análise'}
                </Button>
                <Button variant="secondary" onClick={() => setMode(null)}>Voltar</Button>
              </div>
            </div>
          )}

          <FormError message={error} />

          {mode === null && (
            <div className="flex flex-wrap gap-2">
              {can('RESPOND') && <Button onClick={() => setMode('respond')}>Responder</Button>}
              {can('APPEAL') && <Button onClick={() => setMode('appeal')}>Pedir nova análise</Button>}
              {can('CANCEL') && (
                <Button variant="danger-ghost" loading={busy} onClick={() => setConfirm({ kind: 'cancel' })}>
                  Cancelar pedido
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'remove' ? 'Remover o anexo?' : 'Cancelar o pedido?'}
        description={confirm?.kind === 'remove' ? `${confirm.name} deixa de estar neste pedido.` : 'A seguradora deixa de analisar este pedido. Pode fazer um novo pedido depois.'}
        confirmLabel={confirm?.kind === 'remove' ? 'Remover anexo' : 'Cancelar pedido'}
        cancelLabel="Voltar"
        destructive
        loading={busy}
        onConfirm={() => {
          const action = confirm
          if (!action || !request) return
          void run(() => (action.kind === 'remove' ? clinicAuthorizationsService.removeAttachment(request.id, action.id) : clinicAuthorizationsService.cancel(request.id)), () => setConfirm(null))
        }}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  )
}
