import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import type { ClinicBooking } from '@/types/clinic'
import { ExamOrdersPanel } from './ExamOrdersPanel'

/**
 * Ação "Pedidos de exame (N)" nas linhas de Hoje, Agenda, calendário e ficha (M15 U): abre o painel
 * da marcação num diálogo. Médico: pede/cancela; Admin e Gestor: só leem e imprimem (e só quando já
 * há pedidos).
 */
export function ExamOrdersAction({
  booking,
  onChanged,
}: {
  booking: Pick<ClinicBooking, 'id' | 'patientName' | 'examOrderCount' | 'status'>
  onChanged?: () => void
}) {
  const { isDoctor } = useClinicAuth()
  const [open, setOpen] = useState(false)
  const count = booking.examOrderCount ?? 0
  if (!isDoctor && count === 0) return null
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} icon={<FlaskConical className="size-4" aria-hidden />}>
        {count > 0 ? `Pedidos de exame (${count})` : 'Pedir exames'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Pedidos de exame" description={booking.patientName}>
        {open && (
          <ExamOrdersPanel
            bookingId={booking.id}
            open={booking.status === 'SCHEDULED' || booking.status === 'COMPLETED'}
            onChanged={onChanged}
          />
        )}
      </Modal>
    </>
  )
}
