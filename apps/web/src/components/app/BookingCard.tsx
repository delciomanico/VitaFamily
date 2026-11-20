import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { formatTimeLuanda, luandaDayISO } from '@/lib/format'
import { offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import type { ProfessionalBooking } from '@/types/consultations'

/** Cartão de uma marcação: hora em destaque, quem é, como (vídeo, presencial…) e o estado em palavras simples. */
export function BookingCard({ booking }: { booking: ProfessionalBooking }) {
  const day = luandaDayISO(booking.startsAt).slice(8)
  return (
    <Link
      to={paths.professionalBooking(booking.id)}
      className="flex min-h-[5.5rem] items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong active:bg-surface-muted"
    >
      <span className="flex w-20 shrink-0 flex-col items-center rounded-xl bg-primary-soft py-2 text-primary" aria-hidden>
        <span className="text-xl leading-6 font-semibold tabular-nums">{formatTimeLuanda(booking.startsAt)}</span>
        <span className="text-sm leading-5">dia {day}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-lg leading-6 font-semibold">{booking.participantLabel}</span>
        <span className="text-base text-muted">
          {booking.offer.specialtyName} · {offerMethodLabel[booking.offer.method]}
        </span>
        <StatusBadges status={booking.status} paymentStatus={booking.paymentStatus} priceKz={booking.priceKz} side="PROFESSIONAL" />
        {booking.proof?.status === 'SUBMITTED' && <span className="text-base font-medium text-primary">Comprovativo por analisar.</span>}
      </span>
      <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
