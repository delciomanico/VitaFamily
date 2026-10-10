import { Bell, BellOff, Pill } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { cn } from '@/lib/cn'
import { firstName } from '@/lib/date'
import { formatRelativeDay, formatTime } from '@/lib/format'
import { describeFrequency } from '@/lib/medication'
import { paths } from '@/routes/paths'
import type { MedicationSummary } from '@/types/medication'

/** Estado dos lembretes de um medicamento (“Lembretes ativos”). */
export function ReminderState({ on, className }: { on: boolean; className?: string }) {
  const Icon = on ? Bell : BellOff
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', on ? 'text-primary' : 'text-muted', className)}>
      <Icon className="size-4" aria-hidden />
      {on ? 'Lembretes ativos' : 'Sem lembretes'}
    </span>
  )
}

interface MedicationListProps {
  items: MedicationSummary[]
  selfMemberId?: string
  /** Falso = só leitura (perfil de um membro que partilha, sem acesso ao detalhe). */
  linked?: boolean
}

/** Medicamentos: nome, dosagem, frequência, próxima dose e estado dos lembretes. */
export function MedicationList({ items, selfMemberId, linked = true }: MedicationListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map(({ plan, memberName, nextDoseAt, remindersOn }) => (
        <RowLink key={plan.id} to={paths.medication(plan.id)} linked={linked}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <Pill className="size-5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium">
              {plan.name}
              {plan.memberId !== selfMemberId && (
                <span className="font-normal text-muted"> · {firstName(memberName)}</span>
              )}
            </span>
            <span className="truncate text-sm text-muted">
              {plan.dosage} · {describeFrequency(plan, { short: true })}
            </span>
            <ReminderState on={remindersOn} />
          </span>
          {nextDoseAt && (
            <span className="flex shrink-0 flex-col items-end">
              <span className="sr-only">Próxima dose:</span>
              <span className="text-lg leading-tight font-semibold tabular-nums">{formatTime(nextDoseAt)}</span>
              <span className="text-xs text-muted">{formatRelativeDay(nextDoseAt)}</span>
            </span>
          )}
        </RowLink>
      ))}
    </Card>
  )
}
