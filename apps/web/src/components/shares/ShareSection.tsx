import { Pill } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { formatWhenLuanda } from '@/lib/format'
import { categoriesText, familyShareStatusText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { recordShareService } from '@/services/recordShare.service'
import type { FamilyBooking } from '@/types/consultations'

/** Receita disponível e partilha do registo, numa marcação confirmada ou realizada (MK4, UC-MKT-48/61). */
export function ShareSection({ booking }: { booking: FamilyBooking }) {
  const { user, family } = useAuth()
  const shareable = booking.status === 'CONFIRMED' || booking.status === 'COMPLETED'
  const shares = useAsync(
    () => (shareable ? recordShareService.list(family?.id ?? '', user?.id ?? '', booking.memberId, { bookingId: booking.id }) : Promise.resolve(null)),
    [family?.id, user?.id, booking.memberId, booking.id, shareable],
  )
  const mine = shares.state.status === 'success' && shares.state.data ? shares.state.data.items : []

  return (
    <>
      {booking.prescriptionId && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Pill className="size-5 text-primary" aria-hidden />
            <h2 className="font-semibold">Receita disponível</h2>
          </div>
          <p className="text-sm text-muted">O profissional emitiu uma receita nesta consulta. Pode lê-la e acertar os horários dos lembretes.</p>
          <ButtonLink to={paths.prescription(booking.prescriptionId)} variant="soft" className="w-fit">
            Ver a receita
          </ButtonLink>
        </Card>
      )}
      {shareable && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Partilhar o meu registo</h2>
          <p className="text-sm text-muted">Mostre ao profissional só o que escolher, por tempo limitado. Vê aqui quem abriu e pode parar a partilha quando quiser.</p>
          {mine.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {mine.map((s) => (
                <li key={s.id}>
                  <RowLink to={paths.share(booking.memberId, s.id)}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="truncate text-sm font-medium">{categoriesText(s.categories)}</p>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={familyShareStatusText[s.status].tone} dot>
                          {familyShareStatusText[s.status].label}
                        </Badge>
                        <span className="text-xs text-muted">{s.status === 'ACTIVE' ? `até ${formatWhenLuanda(s.expiresAt)}` : ''}</span>
                      </span>
                    </div>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ButtonLink to={paths.shareCreate(booking.memberId, booking.id)} variant="soft">
              Partilhar o registo
            </ButtonLink>
            <ButtonLink to={paths.shares} variant="secondary">
              Ver todas as partilhas
            </ButtonLink>
          </div>
        </Card>
      )}
    </>
  )
}
