import { CalendarHeart, Search } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

/** Bloco dentro da faixa do topo (sem cartão): uma linha fina separa-o da saudação. */
const blockClass = 'mt-5 flex flex-col gap-3 border-t border-white/25 pt-4'

/**
 * A única ação principal do Início: o próximo compromisso, ou, se não houver, encontrar um profissional.
 */
export function HomePrimaryCard({ next }: { next: HomeSummary['nextAppointment'] }) {
  if (next) {
    const { appointment, memberName, isSelf } = next
    const what = [appointment.specialty ?? 'Consulta', !isSelf && memberName].filter(Boolean).join(' · ')
    return (
      <section aria-labelledby="home-primary" className={blockClass}>
        <div className="flex items-center gap-2 text-white/90">
          <CalendarHeart className="size-5" aria-hidden />
          <h2 id="home-primary" className="text-base font-medium">
            Próximo compromisso
          </h2>
        </div>
        <div>
          <p className="font-display text-[1.5rem] leading-tight font-semibold">{what}</p>
          <p className="mt-0.5 text-lg text-white/90">{formatWhen(appointment.scheduledAt)}</p>
        </div>
        <ButtonLink to={paths.appointment(appointment.id)} variant="light" size="xl" fullWidth>
          Ver compromisso
        </ButtonLink>
      </section>
    )
  }
  return (
    <section aria-labelledby="home-primary" className={blockClass}>
      <div>
        <h2 id="home-primary" className="font-display text-[1.5rem] leading-tight font-semibold">
          Precisa de uma consulta?
        </h2>
        <p className="mt-0.5 text-lg text-white/90">Encontre um médico ou especialista e marque em poucos passos.</p>
      </div>
      <ButtonLink to={paths.marketplace} variant="light" size="xl" fullWidth icon={<Search className="size-5" aria-hidden />}>
        Encontrar um profissional
      </ButtonLink>
    </section>
  )
}
