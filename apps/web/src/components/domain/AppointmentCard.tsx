import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { dateBlock, formatTime } from '@/lib/format'
import { appointmentStatus } from '@/lib/labels'
import type { Appointment } from '@/types/appointment'

interface AppointmentCardProps {
  appointment: Appointment
  /** Nome do membro, quando a consulta não é do próprio utilizador. */
  memberName?: string
  to?: string
  className?: string
}

/** Consulta: bloco de data (15 OUT · 09:30), especialidade, clínica e estado. */
export function AppointmentCard({ appointment, memberName, to, className }: AppointmentCardProps) {
  const { day, month } = dateBlock(appointment.scheduledAt)
  const status = appointmentStatus[appointment.status]
  const title = appointment.specialty ?? appointment.reason ?? 'Consulta'

  const content = (
    <>
      <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-primary-soft py-2 text-primary">
        <span className="text-xs font-semibold tracking-wide">{month}</span>
        <span className="text-xl leading-tight font-semibold">{day}</span>
        <span className="text-xs">{formatTime(appointment.scheduledAt)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate font-medium">{title}</p>
        {appointment.clinicName && <p className="truncate text-sm text-muted">{appointment.clinicName}</p>}
        {memberName && <p className="truncate text-sm text-muted">{memberName}</p>}
        <Badge tone={status.tone} dot className="mt-1 w-fit">
          {status.label}
        </Badge>
      </div>
    </>
  )

  const classes = cn(
    'flex gap-4 rounded-lg border border-border bg-surface p-4 shadow-card',
    to && 'transition-colors hover:border-border-strong active:bg-surface-muted',
    className,
  )

  return to ? (
    <Link to={to} className={classes}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  )
}
