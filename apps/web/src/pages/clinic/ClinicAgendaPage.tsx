import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ClinicBookingList } from '@/components/domain/ClinicBookingList'
import { DateStrip, nextDays } from '@/components/domain/DatePickers'
import { Button } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatRelativeDay } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking } from '@/types/clinic'

/** Dias na tira da agenda da clínica. */
const AGENDA_DAYS = 21

/** Consultas confirmadas por dia (UC-CLN-06), com cancelamento por motivo. */
export function ClinicAgendaPage() {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => clinicPortalService.listClinicBookings(userId), [userId])
  const [day, setDay] = useState<string | null>(todayISO())
  const [cancelling, setCancelling] = useState<ClinicBooking | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const confirmed = state.status === 'success' ? state.data.filter((b) => b.status === 'SCHEDULED') : []
  const marked = new Set(confirmed.map((b) => localDay(b.scheduledAt)))
  const shown = confirmed.filter((b) => !day || localDay(b.scheduledAt) === day)

  async function cancel() {
    if (!cancelling) return
    if (!note.trim()) return setError('Indique o motivo; o paciente vai recebê-lo.')
    setSaving(true)
    try {
      await clinicPortalService.cancelBooking(userId, cancelling.id, note)
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
      <h1 className="text-xl font-semibold">Agenda da clínica</h1>
      <DateStrip
        days={nextDays(AGENDA_DAYS)}
        value={day}
        onChange={setDay}
        marked={marked}
        label="Escolher dia"
        allowClear
      />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <DetailSection title={day ? formatRelativeDay(day) : 'Todas as consultas confirmadas'}>
          {shown.length > 0 ? (
            <ClinicBookingList
              items={shown}
              actions={(booking) =>
                Date.parse(booking.scheduledAt) > Date.now() && (
                  <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(booking)}>
                    Cancelar consulta
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState icon={CalendarDays} title="Sem consultas confirmadas." />
          )}
        </DetailSection>
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
            <Button variant="danger" loading={saving} onClick={cancel}>
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
    </>
  )
}
