import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleSlash, Download } from 'lucide-react'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { MEETING_INFO_MAX, isStateChange, NOTE_MAX, NO_HEALTH_DATA_HINT, PROFESSIONAL_PROOF_NOTICE, cancellationText, paymentStatusText, plainText, proofStatusText, proofTypeLabel } from '@/lib/consultations'
import { saveBlob } from '@/lib/download'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatFileSize, formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import type { ProfessionalBooking } from '@/types/consultations'

type Action = 'confirm' | 'reject' | 'cancel' | 'reject-proof'

/** Marcação do profissional (UC-MKT-30..33, 36): confirmar/recusar, cancelar, concluir/falta e decidir o comprovativo. */
export function ProfessionalBookingPage() {
  const { bookingId = '' } = useParams()
  const profile = useProfessionalProfile()
  const { state, reload } = useAsync(() => professionalBookingService.get(bookingId), [bookingId])
  usePageTitle('Marcação')
  // Ao recarregar (depois de uma ação) mantém-se a marcação anterior em vez de piscar o carregamento.
  const [last, setLast] = useState<{ id: string; booking: ProfessionalBooking } | null>(null)
  if (state.status === 'success' && last?.booking !== state.data) setLast({ id: bookingId, booking: state.data })
  const shown = state.status === 'success' ? state.data : last?.id === bookingId ? last.booking : null
  const approved = profile.profile?.validationStatus === 'APPROVED'
  const back = (
    <Link to={paths.professionalBookings} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar às marcações
    </Link>
  )

  if (!shown && state.status === 'loading') return <div className="flex flex-col gap-4">{back}<LoadingState rows={3} /></div>
  if (state.status === 'error')
    return (
      <div className="flex flex-col gap-4">
        {back}
        {isAppError(state.error, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Marcação não encontrada." /> : <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="text-xl font-semibold">Marcação</h1>
      {profile.profile && !approved && <LockedNotice>A sua conta não está aprovada: só pode consultar esta marcação.</LockedNotice>}
      {shown && <Detail booking={shown} approved={approved} onChanged={reload} />}
    </div>
  )
}

function Detail({ booking, approved, onChanged }: { booking: ProfessionalBooking; approved: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const started = Date.parse(booking.startsAt) <= Date.now()
  const needsInfo = booking.offer.method === 'VIDEO' || booking.offer.method === 'PHONE'

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await task()
      toast.show(done)
    } catch (error) {
      toast.show(isStateChange(error) ? 'O pedido já mudou de estado. Atualizámos a página.' : errorMessage(error), 'error')
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const proof = booking.proof
  return (
    <>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{booking.participantLabel}</h2>
            <p className="text-sm text-muted">
              {booking.offer.specialtyName} · {offerMethodLabel[booking.offer.method]} · {booking.offer.durationMinutes} min
            </p>
          </div>
          <StatusBadges status={booking.status} paymentStatus={booking.paymentStatus} priceKz={booking.priceKz} side="PROFESSIONAL" />
        </div>
        <p className="font-medium">{formatWhenLuanda(booking.startsAt)}</p>
        <p className="text-sm">
          <span className="text-muted">Preço: </span>
          {formatKz(booking.priceKz)}
        </p>
        {booking.meetingInfo && (
          <p className="text-sm">
            <span className="text-muted">{booking.offer.method === 'PHONE' ? 'Número a ligar: ' : 'Ligação: '}</span>
            <span className="break-all">{booking.meetingInfo}</span>
          </p>
        )}
        {booking.status === 'CANCELLED' && (
          <p className="text-sm">
            {cancellationText(booking.cancelledBy, booking.systemReason, 'PROFESSIONAL')}
            {booking.statusReason ? ` Nota: ${booking.statusReason}` : ''}
            {booking.cancelledLate ? ' Cancelada em cima da hora.' : ''}
          </p>
        )}
        {booking.status === 'REJECTED' && booking.statusReason && <p className="text-sm">Motivo da recusa: {booking.statusReason}</p>}
      </Card>

      {approved && booking.status === 'REQUESTED' && (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">A família aguarda a sua resposta. Sem resposta em 48 horas, o pedido é cancelado.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAction('confirm')} disabled={busy}>
              Confirmar
            </Button>
            <Button variant="secondary" onClick={() => setAction('reject')} disabled={busy}>
              Recusar
            </Button>
          </div>
        </Card>
      )}

      {approved && booking.status === 'CONFIRMED' && (
        <Card className="flex flex-col gap-3">
          {started ? (
            <>
              <p className="text-sm">A hora já passou. Indique como correu a consulta.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void run(() => professionalBookingService.complete(booking.id), 'Consulta concluída.')} loading={busy}>
                  Concluir consulta
                </Button>
                <Button variant="secondary" onClick={() => void run(() => professionalBookingService.noShow(booking.id), 'Falta registada.')} disabled={busy}>
                  Registar falta
                </Button>
              </div>
            </>
          ) : (
            <Button variant="danger" className="w-fit" onClick={() => setAction('cancel')} disabled={busy}>
              Cancelar marcação
            </Button>
          )}
        </Card>
      )}

      {proof && booking.priceKz > 0 && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Comprovativo de pagamento</h2>
            <Badge tone={proofStatusText[proof.status].tone}>{proofStatusText[proof.status].label}</Badge>
          </div>
          <p className="text-sm text-muted">
            {proofTypeLabel[proof.contentType]} · {formatFileSize(proof.sizeBytes)} · enviado {formatWhenLuanda(proof.createdAt)} · pagamento: {paymentStatusText[booking.paymentStatus].label.toLowerCase()}
          </p>
          {proof.scanStatus === 'PENDING' && <p className="text-sm text-muted">O ficheiro ainda está a ser verificado.</p>}
          {proof.decisionReason && <p className="text-sm">Motivo indicado: {proof.decisionReason}</p>}
          {proof.status === 'DISPUTED' && <p className="text-sm">A família pediu a análise da Vita Family. Receberá a decisão por e-mail.</p>}
          <p className="text-xs text-muted">{PROFESSIONAL_PROOF_NOTICE}</p>
          <div className="flex flex-wrap gap-2">
            {proof.scanStatus === 'CLEAN' && !proof.purged && (
              <Button
                variant="secondary"
                icon={<Download className="size-4" aria-hidden />}
                onClick={() =>
                  void professionalBookingService
                    .downloadProof(booking.id, proof.id)
                    .then((blob) => saveBlob(blob, `comprovativo.${proofTypeLabel[proof.contentType].toLowerCase()}`))
                    .catch((error: unknown) => toast.show(errorMessage(error), 'error'))
                }
              >
                Descarregar
              </Button>
            )}
            {approved && proof.status === 'SUBMITTED' && proof.scanStatus === 'CLEAN' && (
              <>
                <Button onClick={() => void run(() => professionalBookingService.decideProof(booking.id, proof.id, { decision: 'CONFIRM' }), 'Pagamento confirmado.')} loading={busy}>
                  Confirmar pagamento
                </Button>
                <Button variant="secondary" onClick={() => setAction('reject-proof')} disabled={busy}>
                  Recusar comprovativo
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Receita digital: só aparece com a receita digital ligada (canPrescribe/hasPrescription vêm omitidos senão). */}
      {(booking.canPrescribe || booking.hasPrescription) && (
        <ButtonLink to={paths.professionalPrescription(booking.id)} variant="soft" className="w-fit">
          {booking.hasPrescription ? 'Ver a receita emitida' : 'Emitir receita'}
        </ButtonLink>
      )}

      {(booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') && (
        <ButtonLink to={`${paths.professionalShares}?marcacao=${booking.id}`} variant="secondary" className="w-fit">
          Partilhas desta marcação
        </ButtonLink>
      )}

      {booking.conversationId && (
        <ButtonLink to={paths.professionalConversation(booking.conversationId)} variant="soft" className="w-fit">
          Abrir a conversa
        </ButtonLink>
      )}

      {action && (
        <ActionModal
          action={action}
          needsInfo={needsInfo}
          busy={busy}
          onClose={() => setAction(null)}
          onSubmit={async (text) => {
            const task =
              action === 'confirm'
                ? () => professionalBookingService.confirm(booking.id, text)
                : action === 'reject'
                  ? () => professionalBookingService.reject(booking.id, text ?? '')
                  : action === 'cancel'
                    ? () => professionalBookingService.cancel(booking.id, text ?? '')
                    : () => professionalBookingService.decideProof(booking.id, proof?.id ?? '', { decision: 'REJECT', reason: text })
            setAction(null)
            await run(task, action === 'confirm' ? 'Marcação confirmada.' : action === 'reject' ? 'Pedido recusado.' : action === 'cancel' ? 'Marcação cancelada.' : 'Comprovativo recusado.')
          }}
        />
      )}
    </>
  )
}

const ACTION_TEXT: Record<Action, { title: string; label: string; submit: string; required: boolean; max: number; hint: string }> = {
  confirm: { title: 'Confirmar a marcação', label: 'Ligação ou número a ligar', submit: 'Confirmar', required: false, max: MEETING_INFO_MAX, hint: 'Só a família desta marcação vê esta informação.' },
  reject: { title: 'Recusar o pedido', label: 'Motivo', submit: 'Recusar', required: true, max: NOTE_MAX, hint: `A família vê este motivo. ${NO_HEALTH_DATA_HINT}` },
  cancel: { title: 'Cancelar a marcação', label: 'Motivo', submit: 'Cancelar marcação', required: true, max: NOTE_MAX, hint: `A família vê este motivo. ${NO_HEALTH_DATA_HINT}` },
  'reject-proof': { title: 'Recusar o comprovativo', label: 'Motivo', submit: 'Recusar comprovativo', required: true, max: NOTE_MAX, hint: 'A família vê este motivo e pode pedir a análise da Vita Family.' },
}

function ActionModal({ action, needsInfo, busy, onClose, onSubmit }: { action: Action; needsInfo: boolean; busy: boolean; onClose: () => void; onSubmit: (text?: string) => Promise<void> }) {
  const config = ACTION_TEXT[action]
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const required = action === 'confirm' ? needsInfo : config.required

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = plainText(text, config.max, { required })
    if (value === null) return setError(required ? 'Preencha este campo.' : 'O texto não é válido.')
    void onSubmit(value === '' ? undefined : value)
  }

  return (
    <Modal open onClose={onClose} title={config.title}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {action === 'confirm' ? (
          <Input label={config.label} value={text} onChange={(event) => setText(event.target.value)} maxLength={config.max} hint={needsInfo ? `Obrigatório em vídeo e telefone. ${config.hint}` : `Opcional. ${config.hint}`} />
        ) : (
          <Textarea label={config.label} value={text} onChange={(event) => setText(event.target.value)} maxLength={config.max} hint={`${config.hint} ${text.length}/${config.max} caracteres`} />
        )}
        <FormError message={error} />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" loading={busy}>
            {config.submit}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
