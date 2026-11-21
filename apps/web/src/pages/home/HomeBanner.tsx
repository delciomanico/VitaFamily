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
      className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-5 pt-16 pb-5 text-white"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">Próximo compromisso</span>
        <span className="block truncate font-display text-[1.75rem] leading-tight font-semibold">{what}</span>
        <span className="block text-lg">{formatWhen(appointment.scheduledAt)}</span>
      </span>
      <ChevronRight className="size-7 shrink-0" aria-hidden />
    </Link>
  )
}

function FindProfessionalOverlay() {
  return (
    <Link
      to={paths.marketplace}
      className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-5 pt-16 pb-5 text-white"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[1.75rem] leading-tight font-semibold">Precisa de uma consulta?</span>
        <span className="block text-lg">Encontrar um profissional</span>
      </span>
      <ChevronRight className="size-7 shrink-0" aria-hidden />
    </Link>
  )
}

interface HomeBannerProps {
  next: HomeSummary['nextAppointment']
  /** A carregar: sem texto por cima, para não piscar o convite antes de saber se há compromisso. */
  loading?: boolean
}

/** Cartão principal da Home: ocupa o ecrã, com o próximo compromisso (ou o convite a marcar) por cima da foto. */
export function HomeBanner({ next, loading = false }: HomeBannerProps) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative min-h-60 w-full flex-1 overflow-hidden rounded-3xl bg-primary-soft shadow-hero">
      {failed ? (
        <div className="flex h-full items-center justify-center text-accent" aria-hidden>
          <ImageIcon className="size-10" strokeWidth={1.5} />
        </div>
      ) : (
        <img src={HOME_BANNER_SRC} alt="" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      )}
      {loading ? null : next ? <NextAppointmentOverlay next={next} /> : <FindProfessionalOverlay />}
    </div>
  )
}
