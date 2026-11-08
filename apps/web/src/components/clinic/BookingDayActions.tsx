import { useState, type ReactNode } from 'react'
import { Check, Phone, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatDayMonth } from '@/lib/format'
import { clinicDayService } from '@/services/clinicDay.service'
import type { ClinicBooking } from '@/types/clinic'
import { deriveDayState } from '@/lib/clinicDay'

interface BookingDayActionsProps {
  booking: ClinicBooking
  /** Recarregar a lista depois de uma ação. */
  onChanged: () => void
  /** Abre o fluxo de concluir (resultado e receita opcionais). */
  onComplete: (booking: ClinicBooking) => void
  /** Abre o "Voltar em…" de uma marcação concluída. */
  onFollowUp: (booking: ClinicBooking) => void
  completeLabel?: string
}

type Action = 'arrive' | 'start' | 'noShow' | 'confirm'

/**
 * Ações de um toque sobre uma consulta ou visita (M14 Q, BR-CLN-27/28/30): Chegou, Iniciar,
 * Concluir, Faltou, Confirmado por telefone e Voltar em… O servidor valida o dia e o estado;
 * aqui só se oferece o que faz sentido para o estado derivado.
 */
export function BookingDayActions({
  booking,
  onChanged,
  onComplete,
  onFollowUp,
  completeLabel = 'Concluir',
}: BookingDayActionsProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<Action | null>(null)
  const now = Date.now()
  const state = booking.dayState ?? deriveDayState(booking.status, booking.arrivedAt, booking.startedAt)
  const isToday = localDay(booking.scheduledAt) === todayISO()
  const started = Date.parse(booking.scheduledAt) <= now
  const future = !started
  const messages: Record<Action, string> = {
    arrive: 'Chegada registada.',
    start: 'Consulta iniciada.',
    noShow: 'Falta registada.',
    confirm: 'Confirmada por telefone.',
  }

  const calls: Record<Action, (id: string) => Promise<ClinicBooking>> = {
    arrive: (id) => clinicDayService.arrive(id),
    start: (id) => clinicDayService.start(id),
    noShow: (id) => clinicDayService.noShow(id),
    confirm: (id) => clinicDayService.confirmByPhone(id),
  }

  async function run(action: Action) {
    setBusy(action)
    try {
      await calls[action](booking.id)
      toast.show(messages[action])
      onChanged()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const buttons: ReactNode[] = []
  if (state === 'SCHEDULED') {
    if (isToday) {
      buttons.push(
        <Button key="arrive" size="sm" variant="soft" loading={busy === 'arrive'} onClick={() => void run('arrive')}>
          Chegou
        </Button>,
        <Button key="start" size="sm" variant="soft" loading={busy === 'start'} onClick={() => void run('start')}>
          Iniciar
        </Button>,
      )
    }
    if (started) {
      buttons.push(
        <Button key="done" size="sm" icon={<Check className="size-4" aria-hidden />} onClick={() => onComplete(booking)}>
          {completeLabel}
        </Button>,
        <Button key="noShow" size="sm" variant="danger-ghost" loading={busy === 'noShow'} onClick={() => void run('noShow')}>
          Faltou
        </Button>,
      )
    }
    if (future && (booking.confirmationStatus ?? 'PENDING') === 'PENDING') {
      buttons.push(
        <Button
          key="confirm"
          size="sm"
          variant="secondary"
          icon={<Phone className="size-4" aria-hidden />}
          loading={busy === 'confirm'}
          onClick={() => void run('confirm')}
        >
          Confirmado por telefone
        </Button>,
      )
    }
  } else if (state === 'ARRIVED') {
    buttons.push(
      <Button key="start" size="sm" loading={busy === 'start'} onClick={() => void run('start')}>
        Iniciar
      </Button>,
      <Button key="done" size="sm" variant="soft" onClick={() => onComplete(booking)}>
        {completeLabel}
      </Button>,
    )
  } else if (state === 'IN_PROGRESS') {
    buttons.push(
      <Button key="done" size="sm" icon={<Check className="size-4" aria-hidden />} onClick={() => onComplete(booking)}>
        {completeLabel}
      </Button>,
    )
  } else if (state === 'NO_SHOW' && isToday) {
    // Desfazer a falta: o paciente chegou tarde (BR-CLN-28).
    buttons.push(
      <Button key="arrive" size="sm" variant="soft" loading={busy === 'arrive'} onClick={() => void run('arrive')}>
        Afinal chegou
      </Button>,
    )
  } else if (state === 'COMPLETED') {
    buttons.push(
      <Button
        key="follow"
        size="sm"
        variant={booking.followUpDueOn ? 'ghost' : 'soft'}
        icon={<Repeat className="size-4" aria-hidden />}
        onClick={() => onFollowUp(booking)}
      >
        {booking.followUpDueOn ? `Retorno: ${formatDayMonth(booking.followUpDueOn)}` : 'Voltar em…'}
      </Button>,
    )
  }

  if (buttons.length === 0) return null
  return <div className="flex flex-wrap gap-2">{buttons}</div>
}
