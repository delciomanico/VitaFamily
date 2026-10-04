import type { ReactNode } from 'react'
import { CalendarDays, ClipboardCheck, FlaskConical, Pill, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import { alertTitle } from '@/lib/labels'
import type { AlertItem, AlertType } from '@/types/alert'

const icons: Record<AlertType, LucideIcon> = {
  MEDICATION_DUE: Pill,
  APPOINTMENT_REMINDER: CalendarDays,
  EXAM_REMINDER: FlaskConical,
  APPOINTMENT_OUTCOME_REQUEST: ClipboardCheck,
}

interface AlertCardProps {
  alert: AlertItem
  /** Ação à direita (ex.: marcar como lido). */
  action?: ReactNode
}

/** Linha de alerta: ícone do tipo, título, membro e quando. Ponto colorido = por ler. */
export function AlertCard({ alert, action }: AlertCardProps) {
  const Icon = icons[alert.type]
  const unread = !alert.readAt

  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          unread ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-muted',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', unread ? 'font-medium' : 'text-muted')}>{alertTitle(alert)}</p>
        <p className="text-sm text-muted">
          {alert.memberName} · {formatWhen(alert.triggerAt)}
        </p>
      </div>
      {unread && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">Por ler</span>
        </span>
      )}
      {action}
    </div>
  )
}
