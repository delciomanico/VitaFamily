import { Link } from 'react-router-dom'
import { ArrowRight, CalendarPlus, CalendarDays } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/states'
import { formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

interface NextAppointmentProps {
  next: HomeSummary['nextAppointment']
}

/** Destaque do próximo compromisso agendado (do utilizador ou de um dependente). */
export function NextAppointment({ next }: NextAppointmentProps) {
  if (!next) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Não existem consultas agendadas."
        action={
          <ButtonLink to={paths.appointmentNew} variant="secondary" icon={<CalendarPlus className="size-4" aria-hidden />}>
            Marcar consulta
          </ButtonLink>
        }
      />
    )
  }

  const { appointment, memberName, isSelf } = next
  const title = ['Consulta', appointment.specialty].filter(Boolean).join(' · ')
  const place = [appointment.clinicName, !isSelf && memberName].filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="next-appointment" className="flex flex-col gap-4 rounded-xl bg-primary p-5 text-primary-foreground">
      <h2 id="next-appointment" className="text-sm font-medium opacity-85">
        Próximo compromisso
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-base">{formatWhen(appointment.scheduledAt)}</p>
        {place && <p className="text-sm opacity-85">{place}</p>}
      </div>
      <Link
        to={paths.appointment(appointment.id)}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold hover:underline focus-visible:outline-primary-foreground"
      >
        Ver consulta
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
