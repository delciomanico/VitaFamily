import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { ClinicBookingList } from '@/components/domain/ClinicBookingList'
import { Button } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking } from '@/types/clinic'

/** Pedidos de consulta por responder (UC-CLN-05): confirmar ou recusar com motivo opcional. */
export function ClinicRequestsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => clinicPortalService.listClinicBookings(userId), [userId])
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<ClinicBooking | null>(null)
  const [note, setNote] = useState('')

  const requests = state.status === 'success' ? state.data.filter((b) => b.status === 'REQUESTED') : []

  async function run(id: string, action: () => Promise<unknown>, done: string) {
    setBusy(id)
    try {
      await action()
      toast.show(done)
      setRejecting(null)
      setNote('')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(null)
      reload()
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Pedidos de consulta</h1>
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (requests.length > 0 ? (
          <DetailSection title={`${requests.length} por responder`}>
            <ClinicBookingList
              items={requests}
              actions={(booking) => (
                <>
                  <Button
                    size="sm"
                    className="flex-1 sm:flex-none"
                    loading={busy === booking.id}
                    onClick={() =>
                      run(
                        booking.id,
                        () => clinicPortalService.confirmBooking(userId, booking.id),
                        'Consulta confirmada.',
                      )
                    }
                  >
                    Confirmar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => setRejecting(booking)}
                  >
                    Recusar
                  </Button>
                </>
              )}
            />
          </DetailSection>
        ) : (
          <EmptyState
            icon={Inbox}
            title="Sem pedidos por responder."
            description="Os novos pedidos de consulta aparecem aqui."
          />
        ))}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Recusar pedido?"
        description={rejecting ? `${rejecting.patientName} será informado e o horário volta a ficar livre.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={busy === rejecting?.id}
              onClick={() =>
                rejecting &&
                run(
                  rejecting.id,
                  () => clinicPortalService.rejectBooking(userId, rejecting.id, note),
                  'Pedido recusado.',
                )
              }
            >
              Recusar pedido
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo (opcional)"
          placeholder="Ex.: a médica não está disponível nesse dia"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Modal>
    </>
  )
}
