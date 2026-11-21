import { CalendarHeart, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toneTile } from '@/lib/tones'
import { ButtonLink } from '@/components/ui/Button'
import { formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

/** Cartão que sobe sobre a faixa do topo: a única superfície com sombra forte do Início. */
const cardClass = 'relative z-10 -mt-14 flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-hero'

/**
 * A única ação principal do Início: o próximo compromisso, ou, se não houver, encontrar um profissional.
 */
export function HomePrimaryCard({ next }: { next: HomeSummary['nextAppointment'] }) {
  if (next) {
    const { appointment, memberName, isSelf } = next
    const what = [appointment.specialty ?? 'Consulta', !isSelf && memberName].filter(Boolean).join(' · ')
    return (
      <section aria-labelledby="home-primary" className={cardClass}>
        <div className="flex items-center gap-3">
          <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', toneTile.chat)}>
            <CalendarHeart className="size-7" aria-hidden />
          </span>
          <h2 id="home-primary" className="text-lg font-semibold">
            Próximo compromisso
          </h2>
        </div>
        <div>
          <p className="font-display text-[1.5rem] leading-tight font-semibold">{what}</p>
          <p className="mt-1 text-xl text-muted">{formatWhen(appointment.scheduledAt)}</p>
        </div>
        <ButtonLink to={paths.appointment(appointment.id)} size="xl" fullWidth>
          Ver compromisso
        </ButtonLink>
      </section>
    )
  }
  return (
    <section aria-labelledby="home-primary" className={cardClass}>
      <div className="flex items-center gap-3">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', toneTile.chat)}>
          <Search className="size-7" aria-hidden />
        </span>
        <h2 id="home-primary" className="font-display text-xl font-bold">
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
