import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { ValidationStatusBadge } from '@/components/professional/ValidationStatusBadge'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { saveBlob } from '@/lib/download'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate, formatShortDateLuanda, formatWhenLuanda } from '@/lib/format'
import {
  categoryLabel,
  credentialKindLabel,
  DECISIONS_NEEDS_REASON,
  decisionLabel,
  decisionsFor,
  scanStatusLabel,
  scanStatusTone,
  validationActionLabel,
  validationStatusHint,
  validationStatusLabel,
} from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalAdminService } from '@/services/professionalAdmin.service'
import type {
  AdminProfessionalDetail,
  ProfessionalCredential,
  ProfessionalDecision,
  ValidationCase,
} from '@/types/professional'

const ACTOR_LABEL: Record<ValidationCase['actor'], string> = {
  PROFESSIONAL: 'Profissional',
  PLATFORM_ADMIN: 'Administração',
  SYSTEM: 'Sistema',
}

const DECISION_VARIANT: Record<ProfessionalDecision, 'primary' | 'secondary' | 'danger'> = {
  APPROVE: 'primary',
  REJECT: 'danger',
  REQUEST_INFO: 'secondary',
  SUSPEND: 'danger',
  REACTIVATE: 'primary',
}

const DECISION_DONE: Record<ProfessionalDecision, string> = {
  APPROVE: 'Perfil aprovado. Já está visível.',
  REJECT: 'Perfil rejeitado.',
  REQUEST_INFO: 'Pedido de informação enviado ao profissional.',
  SUSPEND: 'Perfil suspenso.',
  REACTIVATE: 'Perfil reativado.',
}

const REASON_MAX_LENGTH = 500

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

/** Detalhe de um profissional para validação (`/admin/professionals/:id`, UC-MKT-07). */
export function AdminProfessionalDetailPage() {
  const { professionalId = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => professionalAdminService.get(professionalId), [professionalId])

  // Detalhe devolvido por uma decisão; descartado ao recarregar.
  const [updated, setUpdated] = useState<{ id: string; detail: AdminProfessionalDetail } | null>(null)
  const [decision, setDecision] = useState<ProfessionalDecision | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const detail = updated?.id === professionalId ? updated.detail : state.status === 'success' ? state.data : null

  function refresh() {
    setUpdated(null)
    reload()
  }

  function closeDecision() {
    setDecision(null)
    setReason('')
    setReasonError(null)
  }

  const needsReason = decision !== null && DECISIONS_NEEDS_REASON.includes(decision)

  async function decide(value: ProfessionalDecision, text?: string) {
    setDeciding(true)
    try {
      const next = await professionalAdminService.decide(professionalId, { decision: value, reason: text })
      setUpdated({ id: professionalId, detail: next })
      closeDecision()
      toast.show(DECISION_DONE[value])
    } catch (error) {
      const message = errorMessage(error)
      if (isAppError(error, 'INVALID_STATE_TRANSITION')) {
        // Outro administrador decidiu entretanto: mostra o estado atual.
        closeDecision()
        toast.show(message, 'error')
        refresh()
      } else if (DECISIONS_NEEDS_REASON.includes(value)) {
        setReasonError(message)
      } else {
        closeDecision()
        toast.show(message, 'error')
      }
    } finally {
      setDeciding(false)
    }
  }

  function confirmWithReason() {
    if (!decision) return
    const text = reason.trim()
    if (!text) {
      setReasonError('Indique o motivo.')
      return
    }
    void decide(decision, text)
  }

  async function download(credential: ProfessionalCredential) {
    setDownloadingId(credential.id)
    try {
      const blob = await professionalAdminService.downloadCredential(professionalId, credential.id)
      saveBlob(blob, `credencial-${credential.kind}`)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setDownloadingId(null)
    }
  }

  const backLink = (
    <Link to={paths.adminProfessionals} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar à lista
    </Link>
  )

  if (!detail) {
    return (
      <>
        {backLink}
        {state.status === 'error' ? (
          <ErrorState
            message={errorMessage(state.error)}
            onRetry={isAppError(state.error, 'NOT_FOUND') ? undefined : refresh}
          />
        ) : (
          <LoadingState rows={3} />
        )}
      </>
    )
  }

  const availableDecisions = decisionsFor[detail.validationStatus]

  return (
    <>
      {backLink}
      <h1 className="text-xl font-semibold">{detail.displayName || 'Sem nome'}</h1>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ValidationStatusBadge status={detail.validationStatus} />
          <span className="text-sm text-muted">{validationStatusHint[detail.validationStatus]}</span>
        </div>
        <dl className="flex flex-col gap-2">
          {detail.statusReason && <InfoRow label="Motivo">{detail.statusReason}</InfoRow>}
          <InfoRow label="Estado desde">{formatWhenLuanda(detail.statusChangedAt)}</InfoRow>
          <InfoRow label="Submetido">{detail.submittedAt ? formatShortDateLuanda(detail.submittedAt) : 'Ainda não'}</InfoRow>
          <InfoRow label="Aprovado">{detail.approvedAt ? formatShortDateLuanda(detail.approvedAt) : 'Ainda não'}</InfoRow>
        </dl>
      </Card>

      <Card>
        <dl className="flex flex-col gap-2">
          <InfoRow label="E-mail">{detail.email}</InfoRow>
          <InfoRow label="E-mail verificado em">
            {detail.emailVerifiedAt ? formatWhenLuanda(detail.emailVerifiedAt) : 'Não verificado'}
          </InfoRow>
          <InfoRow label="Nome de apresentação">{detail.displayName || '—'}</InfoRow>
          <InfoRow label="Cidade">{detail.city || '—'}</InfoRow>
          <InfoRow label="Bio">{detail.bio ? <span className="whitespace-pre-line">{detail.bio}</span> : '—'}</InfoRow>
          <InfoRow label="Especialidades">
            {detail.specialties.length > 0
              ? detail.specialties.map((specialty) => `${specialty.name} (${categoryLabel[specialty.category]})`).join(', ')
              : 'Sem especialidades'}
          </InfoRow>
        </dl>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Credenciais</h2>
        <Card className="flex flex-col gap-4">
          {detail.credentials.length === 0 && <p className="text-sm text-muted">Sem credenciais carregadas.</p>}
          {detail.credentials.map((credential) => (
            <div key={credential.id} className="flex flex-col gap-2 first:pt-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{credentialKindLabel[credential.kind]}</span>
                <Badge tone={scanStatusTone[credential.scanStatus]} dot>
                  {scanStatusLabel[credential.scanStatus]}
                </Badge>
              </div>
              <dl className="flex flex-col gap-1.5">
                <InfoRow label="Número">{credential.number || '—'}</InfoRow>
                <InfoRow label="Entidade emissora">{credential.issuingBody || '—'}</InfoRow>
                <InfoRow label="Válida até">{credential.validUntil ? formatShortDate(credential.validUntil) : '—'}</InfoRow>
              </dl>
              {/* Só ficheiros verificados pelo antivírus podem ser descarregados (BR-MKT-23). */}
              {credential.scanStatus === 'CLEAN' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  loading={downloadingId === credential.id}
                  onClick={() => void download(credential)}
                  icon={<Download className="size-4" aria-hidden />}
                >
                  Descarregar
                </Button>
              )}
            </div>
          ))}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Decisões</h2>
        <Card className="flex flex-col gap-3">
          {availableDecisions.length === 0 ? (
            <p className="text-sm text-muted">Sem decisões disponíveis neste estado.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableDecisions.map((value) => (
                <Button
                  key={value}
                  variant={DECISION_VARIANT[value]}
                  size="sm"
                  disabled={deciding}
                  onClick={() => setDecision(value)}
                >
                  {decisionLabel[value]}
                </Button>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Histórico</h2>
        <Card>
          {detail.history.length === 0 ? (
            <p className="text-sm text-muted">Sem movimentos registados.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {detail.history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{validationActionLabel[entry.action]}</span>
                    <span className="text-sm text-muted">{formatWhenLuanda(entry.createdAt)}</span>
                  </span>
                  <span className="text-sm text-muted">{ACTOR_LABEL[entry.actor]}</span>
                  {entry.reason && <p className="text-sm whitespace-pre-line">{entry.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      {needsReason && decision && (
        <Modal
          open
          onClose={closeDecision}
          title={decisionLabel[decision]}
          footer={
            <>
              <Button variant="secondary" onClick={closeDecision} disabled={deciding}>
                Voltar
              </Button>
              <Button variant={DECISION_VARIANT[decision]} onClick={confirmWithReason} loading={deciding}>
                {decisionLabel[decision]}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Textarea
              label="Motivo"
              hint="Este motivo é mostrado ao profissional. Não inclua dados de saúde."
              maxLength={REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError(null)
              }}
            />
            <FormError message={reasonError} />
          </div>
        </Modal>
      )}

      {(decision === 'APPROVE' || decision === 'REACTIVATE') && (
        <ConfirmDialog
          open
          title={decision === 'APPROVE' ? 'Aprovar este perfil?' : 'Reativar este perfil?'}
          description={
            decision === 'APPROVE'
              ? `O perfil passa a estar visível. Estado atual: ${validationStatusLabel[detail.validationStatus]}.`
              : 'O perfil volta a ficar ativo.'
          }
          confirmLabel={decisionLabel[decision]}
          loading={deciding}
          onConfirm={() => void decide(decision)}
          onCancel={closeDecision}
        />
      )}
    </>
  )
}
