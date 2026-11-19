import { Badge } from '@/components/ui/Badge'
import { bookingStatusText, paymentStatusText, professionalBookingStatusText } from '@/lib/consultations'
import type { BookingPaymentStatus, BookingStatus } from '@/types/consultations'

/** Estado da marcação e, quando há preço, do pagamento (declarativo, fora da aplicação). */
export function StatusBadges({ status, paymentStatus, priceKz, side = 'FAMILY' }: { status: BookingStatus; paymentStatus: BookingPaymentStatus; priceKz: number; side?: 'FAMILY' | 'PROFESSIONAL' }) {
  const booking = (side === 'FAMILY' ? bookingStatusText : professionalBookingStatusText)[status]
  const payment = paymentStatusText[paymentStatus]
  // O pagamento congela com a marcação terminada sem consulta (cancelada, recusada, falta): não interessa mostrar.
  const showPayment = priceKz > 0 && !['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(status)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={booking.tone} dot>
        {booking.label}
      </Badge>
      {showPayment && <Badge tone={payment.tone}>{payment.label}</Badge>}
    </span>
  )
}
