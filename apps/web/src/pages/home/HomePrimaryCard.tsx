import { CalendarHeart, Search } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

/**
 * A única ação principal do Início: o próximo compromisso, ou, se não houver, encontrar um profissional.
 */
export function HomePrimaryCard({ next }: { next: HomeSummary['nextAppointment'] }) {
  if (next) {
    const { appointment, memberName, isSelf } = next
    const what = [appointment.specialty ?? 'Consulta', !isSelf && memberName].filter(Boolean).join(' · ')
    return (
      <section aria-labelledby="home-primary" className="flex flex-col gap-4 rounded-2xl bg-primary-soft p-5">
        <div className="flex items-center gap-3">
          <CalendarHeart className="size-8 shrink-0 text-primary" aria-hidden />
          <h2 id="home-primary" className="text-lg font-semibold text-primary">
            Próximo compromisso
          </h2>
        </div>
        <div>
          <p className="text-xl font-semibold">{what}</p>
          <p className="text-lg">{formatWhen(appointment.scheduledAt)}</p>
        </div>
        <ButtonLink to={paths.appointment(appointment.id)} size="xl" fullWidth>
          Ver compromisso
        </ButtonLink>
      </section>
    )
  }
  return (
    <section aria-labelledby="home-primary" className="flex flex-col gap-4 rounded-2xl bg-primary-soft p-5">
      <div className="flex items-center gap-3">
        <Search className="size-8 shrink-0 text-primary" aria-hidden />
        <h2 id="home-primary" className="text-lg font-semibold text-primary">
          Precisa de uma consulta?
        </h2>
      </div>
      <p className="text-lg">Encontre um médico ou especialista e marque em poucos passos.</p>
      <ButtonLink to={paths.marketplace} size="xl" fullWidth>
        Encontrar um profissional
      </ButtonLink>
    </section>
  )
}
