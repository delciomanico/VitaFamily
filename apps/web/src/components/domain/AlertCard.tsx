import type { ReactNode } from 'react'
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  ClipboardCheck,
  FlaskConical,
  Pill,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelativeDay, formatWhen } from '@/lib/format'
import { alertTitle } from '@/lib/labels'
import type { AlertItem, AlertType } from '@/types/alert'

const icons: Record<AlertType, LucideIcon> = {
  MEDICATION_DUE: Pill,
  APPOINTMENT_REMINDER: CalendarDays,
  EXAM_REMINDER: FlaskConical,
  APPOINTMENT_OUTCOME_REQUEST: ClipboardCheck,
  APPOINTMENT_CONFIRMED: CalendarCheck,
  APPOINTMENT_REJECTED: CalendarX,
  APPOINTMENT_CANCELLED: CalendarX,
}

/** Quando acontece a origem (“Amanhã · 09:30”; exames só têm dia); senão, quando disparou. */
function when(alert: AlertItem): string {
  if (!alert.sourceAt) return formatWhen(alert.triggerAt)
  return alert.sourceType === 'EXAMINATION' ? formatRelativeDay(alert.sourceAt) : formatWhen(alert.sourceAt)
}

interface AlertCardProps {
  alert: AlertItem
  /** Ação à direita (ex.: marcar como lido). */
  action?: ReactNode
  /** Ponto de “por ler” (falso quando a lista já separa por ler e lidos). */
  dot?: boolean
  /** Versão de altura reduzida (Home). */
  compact?: boolean
}

/** Linha de alerta: ícone do tipo, título, membro e quando. Ponto colorido = por ler. */
export function AlertCard({ alert, action, compact = false, dot = true }: AlertCardProps) {
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
        <p className={cn('text-sm', compact && 'truncate', unread ? 'font-medium' : 'text-muted')}>
          {alertTitle(alert)}
        </p>
        <p className={cn('text-sm text-muted', compact && 'truncate')}>
          {alert.memberName} · {when(alert)}
        </p>
      </div>
      {unread && dot && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">Por ler</span>
        </span>
      )}
      {action}
    </div>
  )
}
