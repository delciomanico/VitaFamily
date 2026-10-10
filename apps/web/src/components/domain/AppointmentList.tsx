import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { appointmentStatusLabel } from '@/lib/appointment'
import { cn } from '@/lib/cn'
import { firstName } from '@/lib/date'
import { dateBlock, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { AppointmentItem } from '@/types/appointment'

interface AppointmentListProps {
  items: AppointmentItem[]
  /** Membro do próprio utilizador: o nome só aparece nas consultas de outros. */
  selfMemberId?: string
  /** Falso = só leitura (perfil de um membro que partilha, sem acesso ao detalhe). */
  linked?: boolean
}

/** Consultas: bloco de data e hora (15 OUT · 09:30), especialidade, clínica e estado. */
export function AppointmentList({ items, selfMemberId, linked = true }: AppointmentListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map(({ appointment, memberName }) => {
        const { day, month } = dateBlock(appointment.scheduledAt)
        const status = appointmentStatusLabel(appointment)
        const muted = appointment.status === 'CANCELLED'
        return (
          <RowLink key={appointment.id} to={paths.appointment(appointment.id)} linked={linked}>
            <span
              className={cn(
                'flex w-14 shrink-0 flex-col items-center rounded-md py-1.5',
                muted ? 'bg-surface-muted text-muted' : 'bg-primary-soft text-primary',
              )}
            >
              <span className="text-[0.6875rem] font-semibold tracking-wide">{month}</span>
              <span className="text-lg leading-tight font-semibold">{day}</span>
              <span className="text-xs tabular-nums">{formatTime(appointment.scheduledAt)}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('truncate font-medium', muted && 'text-muted line-through')}>
                {appointment.specialty ?? appointment.reason ?? 'Consulta'}
                {appointment.memberId !== selfMemberId && (
                  <span className="font-normal text-muted no-underline"> · {firstName(memberName)}</span>
                )}
              </span>
              <span className="truncate text-sm text-muted">{appointment.clinicName ?? 'Sem clínica indicada'}</span>
              <Badge tone={status.tone} dot className="mt-0.5 w-fit">
                {status.label}
              </Badge>
            </span>
          </RowLink>
        )
      })}
    </Card>
  )
}
