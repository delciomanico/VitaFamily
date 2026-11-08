import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, UserPlus } from 'lucide-react'
import { ClinicBookingList } from '@/components/domain/ClinicBookingList'
import { RecommendationModal } from '@/components/domain/RecommendationModal'
import { BookingDayActions } from '@/components/clinic/BookingDayActions'
import { FollowUpModal } from '@/components/clinic/FollowUpModal'
import { ClinicCalendarView } from '@/components/clinic/ClinicCalendarView'
import { IssueReceiptModal } from '@/components/clinic/IssueReceiptModal'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { DaySelector } from '@/components/clinic/DaySelector'
import { nextDays } from '@/components/domain/DatePickers'
import { Button } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatRelativeDay } from '@/lib/format'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking } from '@/types/clinic'
import { CompleteConsultationForm } from './CompleteConsultationForm'

/** Dias na tira da agenda da clínica. */
const AGENDA_DAYS = 21

type View = 'calendar' | 'list'

/**
 * Agenda da clínica (`GET /clinic-portal/agenda`, UC-CLN-06): consultas confirmadas e os seus
 * desfechos, por dia. A clínica cancela uma consulta futura com motivo, e completa a consulta em
 * curso com o resultado e, se quiser, a receita (D18).
 */
export function ClinicAgendaPage() {
  const toast = useToast()
  const navigate = useNavigate()
  // Médico: só a sua agenda, sem consulta presencial nem cancelar (BR-CLN-39).
  const { isDoctor } = useClinicAuth()
  const [receiptFor, setReceiptFor] = useState<ClinicBooking | null>(null)
  const { state, reload } = useAsync(() => clinicPortalService.listAgenda(), [])
  const [day, setDay] = useState<string | null>(todayISO())
  const [cancelling, setCancelling] = useState<ClinicBooking | null>(null)
  const [completing, setCompleting] = useState<ClinicBooking | null>(null)
  const [recommending, setRecommending] = useState<ClinicBooking | null>(null)
  const [walkIn, setWalkIn] = useState(false)
  const [followingUp, setFollowingUp] = useState<ClinicBooking | null>(null)
  const [view, setView] = useState<View>('calendar')
  const [slotToBook, setSlotToBook] = useState<string | undefined>()
  const [calendarVersion, setCalendarVersion] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const bookings = state.status === 'success' ? state.data : []
  const marked = new Set(bookings.map((b) => localDay(b.scheduledAt)))
  const shown = bookings.filter((b) => !day || localDay(b.scheduledAt) === day)

  /** Recarrega a lista e o calendário (mostram o mesmo estado do dia). */
  function refresh() {
    setCalendarVersion((n) => n + 1)
    reload()
  }

  async function cancel() {
    if (!cancelling) return
    if (!note.trim()) return setError('Indique o motivo; o paciente vai recebê-lo.')
    setSaving(true)
    try {
      await clinicPortalService.cancelAppointment(cancelling.id, note)
      toast.show('Consulta cancelada.')
      setCancelling(null)
      setNote('')
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Agenda da clínica</h1>
        {!isDoctor && (
          <Button size="sm" onClick={() => setWalkIn(true)} icon={<UserPlus className="size-4" aria-hidden />}>
            Consulta presencial
          </Button>
        )}
      </div>
      <Tabs
        label="Vista da agenda"
        value={view}
        onChange={setView}
        items={[
          { value: 'calendar', label: 'Calendário' },
          { value: 'list', label: 'Lista' },
        ]}
        className="w-60"
      />
      {view === 'calendar' && (
        <ClinicCalendarView
          version={calendarVersion}
          onBookSlot={
            isDoctor
              ? undefined
              : (slotId) => {
                  setSlotToBook(slotId)
                  setWalkIn(true)
                }
          }
        />
      )}
      {view === 'list' && (
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="lg:sticky lg:top-6">
      <DaySelector
        days={nextDays(AGENDA_DAYS)}
        value={day}
        onChange={setDay}
        marked={marked}
        label="Escolher dia"
        allowClear
      />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <DetailSection title={day ? formatRelativeDay(day) : 'Todas as consultas'}>
          {shown.length > 0 ? (
            <ClinicBookingList
              items={shown}
              showStatus
              actions={(booking) => (
                <>
                  {/* Visita presencial manual: sem recomendação (só para consultas Vita, BR-CLN-09). */}
                  {(booking.status === 'SCHEDULED' || booking.status === 'COMPLETED') && booking.source !== 'MANUAL' && (
                    <Button variant="ghost" size="sm" onClick={() => setRecommending(booking)}>
                      Recomendação
                    </Button>
                  )}
                  {/* Chegou, Iniciar, Completar, Faltou, Confirmado por telefone, Voltar em… (M14 Q). */}
                  <BookingDayActions
                    booking={booking}
                    completeLabel="Completar consulta"
                    onChanged={refresh}
                    onComplete={setCompleting}
                    onFollowUp={setFollowingUp}
                  />
                  {!isDoctor && booking.status === 'SCHEDULED' && Date.parse(booking.scheduledAt) > Date.now() && (
                    <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(booking)}>
                      Cancelar consulta
                    </Button>
                  )}
                </>
              )}
            />
          ) : (
            <EmptyState icon={CalendarDays} title="Sem consultas neste dia." />
          )}
        </DetailSection>
      )}
      </div>
      </div>
      )}

      {walkIn && (
        <WalkInBookingModal
          initialSlotId={slotToBook}
          onClose={() => {
            setWalkIn(false)
            setSlotToBook(undefined)
          }}
          onBooked={(booking) => {
            setWalkIn(false)
            setSlotToBook(undefined)
            setDay(localDay(booking.scheduledAt))
            toast.show('Consulta marcada.')
            setCalendarVersion((n) => n + 1)
            reload()
          }}
        />
      )}

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancelar consulta?"
        description={cancelling ? `${cancelling.patientName} será informado com o motivo indicado.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Voltar
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void cancel()}>
              Cancelar consulta
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          value={note}
          error={error}
          onChange={(event) => {
            setNote(event.target.value)
            setError(undefined)
          }}
        />
      </Modal>

      {recommending && (
        <RecommendationModal
          origin={{ appointmentId: recommending.id }}
          patientName={recommending.patientName}
          onClose={() => setRecommending(null)}
          onSent={() => {
            setRecommending(null)
            toast.show('Recomendação enviada.')
          }}
        />
      )}

      {completing && (
        <CompleteConsultationForm
          booking={completing}
          onClose={() => setCompleting(null)}
          onCompleted={() => {
            const done = completing
            setCompleting(null)
            toast.show('Consulta concluída.')
            refresh()
            if (!isDoctor) setReceiptFor(done)
          }}
        />
      )}

      {receiptFor && (
        <IssueReceiptModal
          bookingKind={receiptFor.source === 'MANUAL' ? 'VISIT' : 'APPOINTMENT'}
          bookingId={receiptFor.id}
          patientName={receiptFor.patientName}
          serviceName={receiptFor.specialty}
          onClose={() => setReceiptFor(null)}
          onIssued={(receipt) => {
            setReceiptFor(null)
            toast.show('Recibo emitido.')
            navigate(paths.clinicReceipt(receipt.id))
          }}
        />
      )}

      {followingUp && (
        <FollowUpModal
          booking={followingUp}
          onClose={() => setFollowingUp(null)}
          onSaved={() => {
            setFollowingUp(null)
            toast.show('Retorno registado.')
            refresh()
          }}
        />
      )}
    </>
  )
}
