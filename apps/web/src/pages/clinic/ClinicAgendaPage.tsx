import { useState } from 'react'
import { CalendarDays, UserPlus } from 'lucide-react'
import { ClinicBookingList } from '@/components/domain/ClinicBookingList'
import { RecommendationModal } from '@/components/domain/RecommendationModal'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { DaySelector } from '@/components/clinic/DaySelector'
import { nextDays } from '@/components/domain/DatePickers'
import { Button } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatRelativeDay } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking } from '@/types/clinic'
import { CompleteConsultationForm } from './CompleteConsultationForm'

/** Dias na tira da agenda da clínica. */
const AGENDA_DAYS = 21

/**
 * Agenda da clínica (`GET /clinic-portal/agenda`, UC-CLN-06): consultas confirmadas e os seus
 * desfechos, por dia. A clínica cancela uma consulta futura com motivo, e completa a consulta em
 * curso com o resultado e, se quiser, a receita (D18).
 */
export function ClinicAgendaPage() {
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicPortalService.listAgenda(), [])
  const [day, setDay] = useState<string | null>(todayISO())
  const [cancelling, setCancelling] = useState<ClinicBooking | null>(null)
  const [completing, setCompleting] = useState<ClinicBooking | null>(null)
  const [recommending, setRecommending] = useState<ClinicBooking | null>(null)
  const [walkIn, setWalkIn] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const bookings = state.status === 'success' ? state.data : []
  const marked = new Set(bookings.map((b) => localDay(b.scheduledAt)))
  const shown = bookings.filter((b) => !day || localDay(b.scheduledAt) === day)

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
        <Button size="sm" onClick={() => setWalkIn(true)} icon={<UserPlus className="size-4" aria-hidden />}>
          Consulta presencial
        </Button>
      </div>
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
              actions={(booking) =>
                (booking.status === 'SCHEDULED' || booking.status === 'COMPLETED') && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setRecommending(booking)}>
                      Recomendação
                    </Button>
                    {booking.status === 'SCHEDULED' &&
                      /* A consulta em curso (hora já passada) é a que se completa (ST4). */
                      (Date.parse(booking.scheduledAt) <= Date.now() ? (
                        <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setCompleting(booking)}>
                          Completar consulta
                        </Button>
                      ) : (
                        <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(booking)}>
                          Cancelar consulta
                        </Button>
                      ))}
                  </>
                )
              }
            />
          ) : (
            <EmptyState icon={CalendarDays} title="Sem consultas neste dia." />
          )}
        </DetailSection>
      )}
      </div>
      </div>

      {walkIn && (
        <WalkInBookingModal
          onClose={() => setWalkIn(false)}
          onBooked={(booking) => {
            setWalkIn(false)
            setDay(localDay(booking.scheduledAt))
            toast.show('Consulta marcada.')
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
            setCompleting(null)
            toast.show('Consulta concluída.')
            reload()
          }}
        />
      )}
    </>
  )
}
