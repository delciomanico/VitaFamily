import { useEffect, useState } from 'react'
import { ChevronDown, CreditCard, Link2Off, Plus, QrCode as QrIcon, RefreshCw } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { QrCode } from '@/components/ui/QrCode'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { AppError, errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatShortDate } from '@/lib/format'
import { formatDays, formatMoney, formatPercent } from '@/lib/insurerFormat'
import { withFallback } from '@/lib/safe'
import { insuranceCardService } from '@/services/insuranceCard.service'
import type { BeneficiaryStatus, LinkRequestStatus } from '@/types/insurerOps'
import {
  cardClaimStatusLabel,
  cardStatusLabel,
  CARD_QR_TTL_SECONDS,
  type InsuranceCard,
  type InsuranceCardClaim,
  type InsuranceCardCoverage,
  type InsuranceCardQr,
} from '@/types/insuranceCard'
import type { PartnerInsurer } from '@/types/insurance'

interface Scope {
  familyId: string
  userId: string
  memberId: string
}

const claimTone = withFallback<LinkRequestStatus, Tone>(
  { PENDING: 'warning', CONFIRMED: 'success', REJECTED: 'danger', REVOKED: 'neutral' },
  () => 'neutral',
)
const claimLabel = withFallback(cardClaimStatusLabel, (key) => key)
const cardTone = withFallback<BeneficiaryStatus, Tone>(
  { PENDING: 'warning', ACTIVE: 'success', SUSPENDED: 'warning', CANCELLED: 'danger' },
  () => 'neutral',
)
const cardLabel = withFallback(cardStatusLabel, (key) => key)

/** Mensagem comum a "não encontrado" e "dados inválidos": o backend não distingue (anti-enumeração, BR-SEG-20). */
const GENERIC_CLAIM_ERROR = 'Não foi possível validar o cartão. Confirme o número da apólice e o código e tente novamente.'

function waitText(seconds: number): string {
  if (seconds >= 120) return `${Math.ceil(seconds / 60)} minutos`
  return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`
}

/**
 * Segundos até `until` (ms), calculados a cada render (sem estado derivado, para nunca mostrar um frame
 * "expirado" quando `until` acaba de mudar); um intervalo de 1 s só provoca o novo render.
 */
function useCountdown(until: number | null): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (until === null) return
    const timer = setInterval(() => {
      tick((n) => n + 1)
      if (Date.now() >= until) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [until])
  return until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000))
}

/** Reclamar o cartão (BR-SEG-20, Q2): nº de apólice + código da seguradora. Erro único e genérico. */
function ClaimCardModal({
  scope,
  insurers,
  onClose,
  onClaimed,
}: {
  scope: Scope
  insurers: PartnerInsurer[]
  onClose: () => void
  onClaimed: () => void
}) {
  const [insurerId, setInsurerId] = useState(insurers.length === 1 ? insurers[0]!.id : '')
  const [policyNumber, setPolicyNumber] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const wait = useCountdown(retryAt)

  async function submit() {
    if (!insurerId || !policyNumber.trim() || !code.trim()) return setError('Escolha a seguradora e preencha o número da apólice e o código.')
    setSaving(true)
    setError(null)
    try {
      await insuranceCardService.claim(scope.familyId, scope.userId, scope.memberId, { insurerId, policyNumber, code })
      onClaimed()
    } catch (err) {
      if (isAppError(err, 'RATE_LIMITED')) {
        const seconds = err instanceof AppError ? Number(err.retryAfterSeconds) : NaN
        setRetryAt(Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : null)
        setError(null)
        if (!(Number.isFinite(seconds) && seconds > 0)) setError('Fez demasiadas tentativas. Aguarde alguns minutos e tente de novo.')
      } else if (isAppError(err, 'CONFLICT')) {
        setError('Já existe um pedido em curso ou um cartão ligado deste membro nesta seguradora.')
      } else if (isAppError(err, 'MEMBER_BLOCKED')) {
        setError(errorMessage(err))
      } else if (isAppError(err, 'NOT_FOUND') || isAppError(err, 'VALIDATION_ERROR')) {
        setError(GENERIC_CLAIM_ERROR)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  const limited = wait > 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Reclamar cartão"
      description="Use o número da apólice e o código que a seguradora lhe entregou. A seguradora confirma o pedido antes de o cartão aparecer."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={limited}>
            {limited ? `Aguarde ${wait} s` : 'Enviar pedido'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!limited) void submit()
        }}
      >
        {insurers.length === 0 ? (
          <p className="text-sm text-muted">Não há seguradoras parceiras disponíveis neste momento.</p>
        ) : (
          <Select
            label="Seguradora"
            placeholder="Escolher seguradora"
            value={insurerId}
            options={insurers.map((i) => ({ value: i.id, label: i.name }))}
            onChange={(event) => {
              setInsurerId(event.target.value)
              setError(null)
            }}
          />
        )}
        <Input
          label="Número da apólice"
          autoComplete="off"
          value={policyNumber}
          onChange={(event) => {
            setPolicyNumber(event.target.value)
            setError(null)
          }}
        />
        <Input
          label="Código da seguradora"
          hint="8 caracteres, como XXXX-XXXX. Maiúsculas ou minúsculas e o hífen não importam."
          autoComplete="off"
          autoCapitalize="characters"
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
        {limited && (
          <p role="alert" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm text-warning">
            Fez demasiadas tentativas. Tente de novo dentro de {waitText(wait)}.
          </p>
        )}
      </form>
    </Modal>
  )
}

/** QR do cartão (BR-SEG-18): token de validade curta (120 s), com contagem decrescente e renovação. */
function QrModal({ scope, card, onClose }: { scope: Scope; card: InsuranceCard; onClose: () => void }) {
  const [qr, setQr] = useState<InsuranceCardQr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    insuranceCardService.getQr(scope.familyId, scope.userId, scope.memberId, card.beneficiaryId).then(
      (next) => {
        if (!active) return
        setQr(next)
        setLoading(false)
      },
      (err: unknown) => {
        if (!active) return
        const seconds = err instanceof AppError ? Number(err.retryAfterSeconds) : NaN
        setError(
          isAppError(err, 'RATE_LIMITED')
            ? `Pediu demasiados códigos. Tente de novo ${seconds > 0 ? `dentro de ${waitText(seconds)}` : 'daqui a alguns minutos'}.`
            : errorMessage(err),
        )
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [scope.familyId, scope.userId, scope.memberId, card.beneficiaryId, attempt])

  // Se o servidor devolver uma validade absurda, a app limita-se à da especificação.
  const expiresMs = qr ? Math.min(new Date(qr.expiresAt).getTime(), Date.now() + CARD_QR_TTL_SECONDS * 1000 + 5000) : null
  const left = useCountdown(expiresMs)
  const expired = qr !== null && left === 0
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <Modal
      open
      onClose={onClose}
      title="QR do cartão"
      description={`${card.insurerName} · cartão ${card.cardNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={() => setAttempt((n) => n + 1)}
            loading={loading}
            variant={expired ? 'primary' : 'soft'}
            icon={<RefreshCw className="size-4" aria-hidden />}
          >
            Renovar QR
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {loading && !qr && <LoadingState rows={1} label="A gerar o QR…" />}
        <FormError message={error} />
        {qr && !error && (
          <>
            <div className={expired ? 'opacity-20' : undefined}>
              <QrCode value={qr.token} label={`QR do cartão ${card.cardNumber}`} className="size-56 rounded-lg border border-border" />
            </div>
            {expired ? (
              <p role="status" className="text-sm font-medium text-danger">
                O QR expirou. Renove para gerar um novo.
              </p>
            ) : (
              <p role="timer" className="text-sm text-muted">
                Expira em <span className="font-semibold tabular-nums text-foreground">{mm}</span>
              </p>
            )}
            <p className="text-center text-sm text-muted">
              Mostre este código na clínica. Muda a cada pedido e não contém dados de saúde.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Plano, limites anuais e carências (UC-SEG-14, D-A2): sem «usado» nem saldo. */
function CoveragePanel({ scope, card }: { scope: Scope; card: InsuranceCard }) {
  const { state, reload } = useAsync(
    () => insuranceCardService.getCoverage(scope.familyId, scope.userId, scope.memberId, card.beneficiaryId),
    [scope.familyId, scope.userId, scope.memberId, card.beneficiaryId],
  )
  if (state.status === 'loading') return <LoadingState rows={1} />
  if (state.status === 'error') return <ErrorState onRetry={reload} />
  const coverage: InsuranceCardCoverage = state.data
  const items = Array.isArray(coverage.coverages) ? coverage.coverages : []

  if (coverage.status !== 'ACTIVE') {
    return <p className="text-sm text-muted">Cartão {cardLabel[coverage.status].toLowerCase()}: não há coberturas a mostrar.</p>
  }
  if (!coverage.planName && items.length === 0) {
    return <p className="text-sm text-muted">Sem apólice ativa em vigor. Contacte a seguradora.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        Limites anuais do plano, em {coverage.currency === 'AOA' ? 'kwanzas (Kz)' : coverage.currency}. O valor já usado ainda não é mostrado.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Este plano não tem serviços cobertos.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((c) => (
            <li key={c.serviceCode} className="flex flex-col gap-1 py-2.5">
              <span className="font-medium">{c.serviceName}</span>
              <span className="text-sm text-muted">
                Paga {formatPercent(c.copayPct)} · {c.limitPerYear != null ? `limite anual ${formatMoney(c.limitPerYear, coverage.currency)}` : 'sem limite anual'}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {!c.coveredNow && (
                  <Badge tone="warning">
                    Em carência{c.waitingEndsOn ? ` até ${formatShortDate(c.waitingEndsOn)}` : c.waitingDays ? ` (${formatDays(c.waitingDays)})` : ''}
                  </Badge>
                )}
                {c.requiresAuthorization && <Badge tone="primary">Exige autorização</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DigitalCard({
  scope,
  card,
  claimId,
  onChanged,
}: {
  scope: Scope
  card: InsuranceCard
  claimId: string | undefined
  onChanged: () => void
}) {
  const toast = useToast()
  const [showQr, setShowQr] = useState(false)
  const [open, setOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const covId = `cov-${card.beneficiaryId}`

  async function unlink() {
    if (!claimId) return
    setBusy(true)
    try {
      await insuranceCardService.revoke(scope.familyId, scope.userId, scope.memberId, claimId)
      toast.show(`Cartão ${card.insurerName} desligado.`)
      setUnlinking(false)
      onChanged()
    } catch (error) {
      toast.show(isAppError(error, 'CONFLICT') ? 'Este cartão já não está ligado.' : errorMessage(error), 'error')
      setUnlinking(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3" aria-label={`Cartão ${card.insurerName}`} role="group">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{card.insurerName}</span>
          <span className="block truncate text-sm text-muted">{card.beneficiaryName}</span>
        </span>
        <Badge tone={cardTone[card.status]} dot>
          {cardLabel[card.status]}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="col-span-2">
          <dt className="text-muted">Nº do cartão</dt>
          <dd className="font-mono text-base font-semibold tracking-wide">{card.cardNumber}</dd>
        </div>
        <div>
          <dt className="text-muted">Plano</dt>
          <dd>{card.planName ?? 'Sem apólice ativa'}</dd>
        </div>
        <div>
          <dt className="text-muted">Válido até</dt>
          <dd>{card.validTo ? formatLongDate(card.validTo) : '—'}</dd>
        </div>
      </dl>
      {card.status !== 'ACTIVE' && (
        <p className="text-sm text-muted">Este cartão não está ativo; a seguradora é quem decide o estado.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setShowQr(true)} icon={<QrIcon className="size-4" aria-hidden />}>
          Mostrar QR <span className="sr-only">do cartão {card.insurerName}</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          aria-controls={covId}
          onClick={() => setOpen((v) => !v)}
          icon={<ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />}
        >
          Cobertura e limites <span className="sr-only">de {card.insurerName}</span>
        </Button>
        {claimId && (
          <Button size="sm" variant="danger-ghost" onClick={() => setUnlinking(true)} icon={<Link2Off className="size-4" aria-hidden />}>
            Desligar <span className="sr-only">cartão {card.insurerName}</span>
          </Button>
        )}
      </div>
      <div id={covId} hidden={!open}>
        {open && <CoveragePanel scope={scope} card={card} />}
      </div>
      {showQr && <QrModal scope={scope} card={card} onClose={() => setShowQr(false)} />}
      <ConfirmDialog
        open={unlinking}
        title="Desligar cartão?"
        description={`A seguradora ${card.insurerName} deixa de poder ver a ligação e os QR já emitidos deixam de valer. Pode reclamar o cartão de novo com um código novo.`}
        confirmLabel="Desligar"
        destructive
        loading={busy}
        onConfirm={() => void unlink()}
        onCancel={() => setUnlinking(false)}
      />
    </Card>
  )
}

/**
 * Cartão digital do membro (Fase A, S6; UC-SEG-14/15): reclamar, estado dos pedidos, cartões por seguradora,
 * QR, cobertura e desligar. Só o próprio ou o tutor chegam aqui (BR-INS-02); os restantes recebem 404.
 */
export function InsuranceCardsSection({ scope, insurers }: { scope: Scope; insurers: PartnerInsurer[] }) {
  const toast = useToast()
  const { state, reload } = useAsync(
    async () => ({
      claims: await insuranceCardService.listClaims(scope.familyId, scope.userId, scope.memberId),
      cards: await insuranceCardService.listCards(scope.familyId, scope.userId, scope.memberId),
    }),
    [scope.familyId, scope.userId, scope.memberId],
  )
  const [claiming, setClaiming] = useState(false)

  const action = (
    <Button size="sm" variant="secondary" onClick={() => setClaiming(true)} icon={<Plus className="size-4" aria-hidden />}>
      Reclamar cartão
    </Button>
  )

  let body
  if (state.status === 'loading') body = <LoadingState rows={1} />
  else if (state.status === 'error') {
    body = isAppError(state.error, 'MEMBER_BLOCKED') ? (
      <ErrorState message="O perfil deste membro está bloqueado." />
    ) : isAppError(state.error, 'NOT_FOUND') || isAppError(state.error, 'FORBIDDEN') ? (
      <ErrorState message="Só o próprio ou o tutor podem ver o cartão de seguro deste membro." />
    ) : (
      <ErrorState onRetry={reload} />
    )
  } else {
    const claims: InsuranceCardClaim[] = Array.isArray(state.data.claims) ? state.data.claims : []
    const cards: InsuranceCard[] = Array.isArray(state.data.cards) ? state.data.cards : []
    const claimOf = (card: InsuranceCard) => claims.find((c) => c.status === 'CONFIRMED' && c.beneficiaryId === card.beneficiaryId)?.id
    const requests = claims.filter((c) => c.status !== 'CONFIRMED')
    body =
      cards.length === 0 && claims.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Ainda não ligou o cartão da seguradora."
          description="Peça à seguradora o código de reclamação e use-o aqui, com o número da apólice, para ter o cartão e a cobertura no telemóvel."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <DigitalCard key={card.beneficiaryId} scope={scope} card={card} claimId={claimOf(card)} onChanged={reload} />
          ))}
          {requests.length > 0 && (
            <Card className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-muted">Pedidos de ligação</h3>
              <ul className="divide-y divide-border">
                {requests.map((claim) => (
                  <li key={claim.id} className="flex flex-col gap-1 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{claim.insurerName}</span>
                      <Badge tone={claimTone[claim.status]} dot>
                        {claimLabel[claim.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted">
                      Pedido em {formatShortDate(claim.requestedAt)}
                      {claim.decidedAt ? ` · decidido em ${formatShortDate(claim.decidedAt)}` : ''}
                    </p>
                    {claim.status === 'PENDING' && (
                      <p className="text-sm text-muted">A seguradora ainda não confirmou. O cartão aparece aqui depois.</p>
                    )}
                    {claim.status === 'REJECTED' && (
                      <p className="text-sm">
                        A seguradora rejeitou o pedido{claim.decisionNote ? `: ${claim.decisionNote}` : '.'} Pode tentar de novo com um código novo.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="insurance-cards-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="insurance-cards-title" className="text-lg font-semibold">
          Cartão da seguradora
        </h2>
        {state.status === 'success' && action}
      </div>
      {body}
      {claiming && (
        <ClaimCardModal
          scope={scope}
          insurers={insurers}
          onClose={() => setClaiming(false)}
          onClaimed={() => {
            setClaiming(false)
            toast.show('Pedido enviado. A seguradora vai confirmar a ligação.')
            reload()
          }}
        />
      )}
    </section>
  )
}
