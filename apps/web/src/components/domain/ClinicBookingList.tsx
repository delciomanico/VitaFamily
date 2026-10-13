import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { dateBlock, formatTime } from '@/lib/format'
import { appointmentStatus } from '@/lib/labels'
import type { ClinicBooking } from '@/types/clinic'

interface ClinicBookingListProps {
  items: ClinicBooking[]
  /** Ações de cada marcação (ex.: Confirmar / Recusar). */
  actions?: (booking: ClinicBooking) => ReactNode
  /** Estado de cada consulta (agenda da clínica, onde convivem agendadas e desfechos). */
  showStatus?: boolean
}

/** Marcações vistas pela clínica: data e hora, paciente, especialidade e profissional, observações. */
export function ClinicBookingList({ items, actions, showStatus = false }: ClinicBookingListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map((booking) => {
        const { day, month } = dateBlock(booking.scheduledAt)
        const status = appointmentStatus[booking.status]
        return (
          <div key={booking.id} className="flex flex-col gap-3 py-3">
            <div className="flex items-start gap-3">
              <span className="flex w-14 shrink-0 flex-col items-center rounded-md bg-primary-soft py-1.5 text-primary">
                <span className="text-[0.6875rem] font-semibold tracking-wide">{month}</span>
                <span className="text-lg leading-tight font-semibold">{day}</span>
                <span className="text-xs tabular-nums">{formatTime(booking.scheduledAt)}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{booking.patientName}</span>
                  {showStatus && (
                    <Badge tone={status.tone} dot className="ml-auto">
                      {status.label}
                    </Badge>
                  )}
                </span>
                <p className="truncate text-sm text-muted">
                  {[booking.specialty, booking.professionalName].filter(Boolean).join(' · ')}
                </p>
                {booking.notes && <p className="text-sm">“{booking.notes}”</p>}
                {booking.responseNote && <p className="text-sm text-muted">Motivo: {booking.responseNote}</p>}
              </div>
            </div>
            {actions && <div className="flex gap-2 sm:justify-end">{actions(booking)}</div>}
          </div>
        )
      })}
    </Card>
  )
}
