import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ImageIcon } from 'lucide-react'
import { formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

/**
 * Imagem do banner da Home, fornecida pelo proprietário (com licença).
 * Basta substituir `public/images/home-banner.jpg`; sem ficheiro aparece um marcador neutro.
 */
export const HOME_BANNER_SRC = '/images/home-banner.jpg'

function NextAppointmentOverlay({ next }: { next: NonNullable<HomeSummary['nextAppointment']> }) {
  const { appointment, memberName, isSelf } = next
  const what = [appointment.specialty ?? 'Consulta', !isSelf && memberName].filter(Boolean).join(' · ')
  return (
    <Link
      to={paths.appointment(appointment.id)}
      className="absolute inset-x-0 bottom-0 flex items-end gap-3 rounded-b-xl bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pt-8 pb-3 text-white"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">Próximo compromisso</span>
        <span className="block truncate text-base font-semibold">{what}</span>
        <span className="block text-sm">{formatWhen(appointment.scheduledAt)}</span>
      </span>
      <ChevronRight className="size-5 shrink-0" aria-hidden />
    </Link>
  )
}

interface HomeBannerProps {
  next: HomeSummary['nextAppointment']
}

/** Banner compacto da Home (até ~1/4 do ecrã), com o próximo compromisso por cima. */
export function HomeBanner({ next }: HomeBannerProps) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative aspect-[2/1] max-h-[24dvh] w-full shrink-0 overflow-hidden rounded-xl bg-primary-soft md:aspect-[3/1]">
      {failed ? (
        <div className="flex h-full items-center justify-center text-accent" aria-hidden>
          <ImageIcon className="size-10" strokeWidth={1.5} />
        </div>
      ) : (
        <img src={HOME_BANNER_SRC} alt="" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      )}
      {next && <NextAppointmentOverlay next={next} />}
    </div>
  )
}
