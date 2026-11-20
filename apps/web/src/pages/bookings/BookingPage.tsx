import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import { Sheet } from '@/components/app/Sheet'
import { Page } from '@/components/layout/Page'
import { PaymentSection } from '@/components/consultations/PaymentSection'
import { ReviewSection } from '@/components/consultations/ReviewSection'
import { ShareSection } from '@/components/shares/ShareSection'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Disclosure } from '@/components/ui/Disclosure'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { CANCELLATION_NOTICE, isStateChange, LATE_CANCEL_MS, NO_HEALTH_DATA_HINT, NOTE_MAX, cancellationText, plainText } from '@/lib/consultations'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { nextStepSentence } from '@/lib/labels'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { safeHref } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { consultationService } from '@/services/consultation.service'
import { processService } from '@/services/process.service'
import type { FamilyBooking } from '@/types/consultations'

/** Marcação do membro (`/app/bookings/:memberId/:bookingId`): estado, o que falta, pagamento, comprovativo e avaliação (MK3). */
export function BookingPage() {
  const { user, family } = useAuth()
  const { memberId = '', bookingId = '' } = useParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => consultationService.get(familyId, userId, memberId, bookingId), [familyId, userId, memberId, bookingId])
  // Ao recarregar (depois de uma ação) mantém-se a marcação anterior em vez de piscar o carregamento.
  const [last, setLast] = useState<{ id: string; booking: FamilyBooking } | null>(null)
  if (state.status === 'success' && last?.booking !== state.data) setLast({ id: bookingId, booking: state.data })
  const booking = state.status === 'success' ? state.data : last?.id === bookingId ? last.booking : null
  usePageTitle(booking ? `Marcação com ${booking.professional.displayName}` : 'Marcação')

  if (!booking && state.status === 'loading') {
    return (
      <Page title="Marcação" backTo={paths.bookings}>
        <LoadingState rows={3} />
      </Page>
    )
  }
  if (state.status === 'error') {
    return (
      <Page title="Marcação" backTo={paths.bookings}>
        {isAppError(state.error, 'NOT_FOUND') ? (
          <EmptyState icon={CircleSlash} title="Esta marcação já não está disponível." />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={reload} />
        )}
      </Page>
    )
  }
  return (
    <Page title="Marcação" backTo={paths.bookings} backLabel="Marcações">
      {booking && <BookingDetail booking={booking} onChanged={reload} />}
    </Page>
  )
}

function BookingDetail({ booking, onChanged }: { booking: FamilyBooking; onChanged: () => void }) {
  const { user, family } = useAuth()
  const [cancelling, setCancelling] = useState(false)
  const process = useAsync(
    () => (booking.processId ? processService.getProcess(family?.id ?? '', user?.id ?? '', booking.memberId, booking.processId) : Promise.resolve(null)),
    [family?.id, user?.id, booking.memberId, booking.processId, booking.updatedAt, booking.hasReview],
  )
  const when = formatWhenLuanda(booking.startsAt)
  const terminal = ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(booking.status)

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{booking.professional.displayName}</h2>
            <p className="text-sm text-muted">
              {booking.offer.specialtyName} · {offerMethodLabel[booking.offer.method]} · {booking.offer.durationMinutes} min
            </p>
          </div>
          <StatusBadges status={booking.status} paymentStatus={booking.paymentStatus} priceKz={booking.priceKz} />
        </div>
        <p className="font-medium">{when}</p>
        <p className="text-sm">
          <span className="text-muted">Preço: </span>
          {formatKz(booking.priceKz)}
        </p>
        <p className="text-sm text-muted">Tratado/a como {booking.participantLabel}</p>
        {booking.meetingInfo && (
          <p className="text-sm">
            <span className="text-muted">{booking.offer.method === 'PHONE' ? 'Número a ligar: ' : 'Ligação: '}</span>
            {safeHref(booking.meetingInfo) ? (
              <a href={safeHref(booking.meetingInfo)} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-primary underline">
                {booking.meetingInfo}
              </a>
            ) : (
              <span className="break-all">{booking.meetingInfo}</span>
            )}
          </p>
        )}
        {booking.status === 'REJECTED' && <p className="text-sm">O profissional recusou o pedido.{booking.statusReason ? ` Motivo: ${booking.statusReason}` : ''}</p>}
        {booking.status === 'CANCELLED' && (
          <p className="text-sm">
            {cancellationText(booking.cancelledBy, booking.systemReason)}
            {booking.statusReason ? ` Nota: ${booking.statusReason}` : ''}
            {booking.cancelledLate ? ' Foi cancelada em cima da hora.' : ''}
          </p>
        )}
        {booking.status === 'REQUESTED' && <p className="text-sm text-muted">Se o profissional não responder em 48 horas, o pedido é cancelado e o horário fica livre.</p>}
      </Card>

      {process.state.status === 'success' && process.state.data && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">O que falta</p>
          <p className="font-medium">{nextStepSentence(process.state.data.nextStep)}</p>
        </Card>
      )}

      <PaymentSection booking={booking} onChanged={onChanged} />
      <ReviewSection booking={booking} onChanged={onChanged} />
      <ShareSection booking={booking} />

      <div className="flex flex-col gap-3">
        {booking.appointmentId && !terminal && (
          <ButtonLink to={paths.appointment(booking.appointmentId)} variant="soft" size="xl">
            Ver na minha agenda
          </ButtonLink>
        )}
        {booking.conversationId && (
          <ButtonLink to={paths.messageThread(booking.memberId, booking.conversationId)} variant="soft" size="xl">
            Abrir a conversa
          </ButtonLink>
        )}
        <ButtonLink to={paths.marketplaceProfessional(booking.professional.id, booking.offer.specialtyId)} variant="soft" size="xl">
          Ver o profissional
        </ButtonLink>
        {booking.canCancel && (
          <Button variant="danger-ghost" size="xl" onClick={() => setCancelling(true)}>
            Cancelar marcação
          </Button>
        )}
      </div>

      {terminal && booking.status !== 'REJECTED' && (
        <p className="text-sm text-muted">
          Quer voltar a marcar?{' '}
          <Link to={paths.marketplaceProfessional(booking.professional.id, booking.offer.specialtyId)} className="font-medium text-primary">
            Ver horários livres
          </Link>
        </p>
      )}

      {cancelling && <CancelModal booking={booking} onClose={() => setCancelling(false)} onDone={onChanged} />}
    </div>
  )
}

function CancelModal({ booking, onClose, onDone }: { booking: FamilyBooking; onClose: () => void; onDone: () => void }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const late = Date.parse(booking.startsAt) - Date.now() < LATE_CANCEL_MS

  async function submit() {
    const text = note.trim() === '' ? undefined : plainText(note, NOTE_MAX)
    if (text === null) return setError(`Escreva até ${NOTE_MAX} caracteres, sem símbolos especiais.`)
    setSending(true)
    try {
      await consultationService.cancel(family?.id ?? '', user?.id ?? '', booking.memberId, booking.id, text)
      toast.show('Marcação cancelada.')
      onClose()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
      if (isStateChange(e)) onDone()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Cancelar esta marcação?"
      description={`${booking.professional.displayName} · ${formatWhenLuanda(booking.startsAt)}`}
      footer={
        <>
          <Button size="xl" variant="danger" fullWidth loading={sending} onClick={() => void submit()}>
            Sim, cancelar marcação
          </Button>
          <Button size="xl" variant="secondary" fullWidth disabled={sending} onClick={onClose}>
            Não, manter
          </Button>
        </>
      }
    >
      {late && (
        <p role="note" className="rounded-xl bg-warning-soft px-4 py-3 text-base">
          Falta menos de 24 horas para a consulta: o cancelamento fica registado como «em cima da hora».
        </p>
      )}
      <p className="text-sm text-muted">{CANCELLATION_NOTICE}</p>
      <Disclosure label="Deixar uma nota ao profissional">
        <Textarea label="Nota para o profissional (opcional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} hint={`${NO_HEALTH_DATA_HINT} ${note.length}/${NOTE_MAX} caracteres`} />
      </Disclosure>
      <FormError message={error} />
    </Sheet>
  )
}
