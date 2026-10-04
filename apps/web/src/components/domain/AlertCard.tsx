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
  /** Versão de altura reduzida (Home). */
  compact?: boolean
}

/** Linha de alerta: ícone do tipo, título, membro e quando. Ponto colorido = por ler. */
export function AlertCard({ alert, action, compact = false }: AlertCardProps) {
  const Icon = icons[alert.type]
  const unread = !alert.readAt

  return (
    <div className={cn('flex items-start gap-3', compact ? 'py-2' : 'py-3')}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full',
          compact ? 'size-9' : 'size-10',
          unread ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-muted',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', compact && 'truncate', unread ? 'font-medium' : 'text-muted')}>{alertTitle(alert)}</p>
        <p className={cn('text-sm text-muted', compact && 'truncate')}>
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
