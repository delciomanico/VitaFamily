import { CalendarDays, FlaskConical, Info, Pill, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { firstName } from '@/lib/date'
import { formatCount, formatRelativeDay, formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { PendingItem, PendingItemType } from '@/types/report'
import type { SharingCategory } from '@/types/sharing'

interface FollowUpArea {
  type: PendingItemType
  category: SharingCategory
  label: string
  icon: LucideIcon
  /** “1 toma por confirmar”. */
  count: (n: number) => string
}

const areas: FollowUpArea[] = [
  {
    type: 'APPOINTMENT_OUTCOME',
    category: 'APPOINTMENTS',
    label: 'Consultas',
    icon: CalendarDays,
    count: (n) => `${formatCount(n, 'consulta', 'consultas')} por atualizar`,
  },
  {
    type: 'EXAM_OUTCOME',
    category: 'EXAMS',
    label: 'Exames',
    icon: FlaskConical,
    count: (n) => `${formatCount(n, 'exame', 'exames')} por atualizar`,
  },
  {
    type: 'UNCONFIRMED_DOSE',
    category: 'MEDICATION',
    label: 'Medicamentos',
    icon: Pill,
    count: (n) => `${formatCount(n, 'toma', 'tomas')} por confirmar`,
  },
]

const titles: Record<PendingItemType, string> = {
  APPOINTMENT_OUTCOME: 'Consulta por atualizar',
  EXAM_OUTCOME: 'Exame por atualizar',
  UNCONFIRMED_DOSE: 'Toma por confirmar',
}

/**
 * Acompanhamento por área: “Em dia” ou o número de pendentes. Só as áreas que o utilizador
 * pode ver; é um registo do que falta atualizar, não uma avaliação de saúde (BR-RPT-03).
 */
export function FollowUpList({ categories, pending }: { categories: SharingCategory[]; pending: PendingItem[] }) {
  const visible = areas.filter((area) => categories.includes(area.category))
  return (
    <Card className="divide-y divide-border py-1">
      {visible.map(({ type, label, icon: Icon, count }) => {
        const n = pending.filter((p) => p.type === type).length
        return (
          <div key={type} className="flex items-center gap-3 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
              <Icon className="size-[1.125rem]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 font-medium">{label}</span>
            <Badge tone={n > 0 ? 'warning' : 'success'} dot>
              {n > 0 ? count(n) : 'Em dia'}
            </Badge>
          </div>
        )
      })}
    </Card>
  )
}

function pendingTarget(item: PendingItem): string {
  switch (item.type) {
    case 'UNCONFIRMED_DOSE':
      return paths.medication(item.targetId)
    case 'APPOINTMENT_OUTCOME':
      return paths.appointment(item.targetId)
    case 'EXAM_OUTCOME':
      return paths.examination(item.targetId)
  }
}

interface PendingListProps {
  items: PendingItem[]
  /** Nome do membro de cada item (visão familiar); omitido no relatório de um só membro. */
  memberNameOf?: (memberId: string) => string
  /** Só abre o detalhe dos membros que o utilizador gere. */
  canOpen: (memberId: string) => boolean
}

/** Lista dos itens pendentes, com ligação ao registo a atualizar. */
export function PendingList({ items, memberNameOf, canOpen }: PendingListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map((item) => {
        const when = item.type === 'EXAM_OUTCOME' ? formatRelativeDay(item.date) : formatWhen(item.date)
        return (
          <RowLink key={`${item.type}-${item.sourceId}`} to={pendingTarget(item)} linked={canOpen(item.memberId)}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">
                {titles[item.type]}: {item.label}
              </span>
              <span className="truncate text-sm text-muted">
                {memberNameOf ? `${firstName(memberNameOf(item.memberId))} · ` : ''}
                {when}
              </span>
            </span>
          </RowLink>
        )
      })}
    </Card>
  )
}

/** Aviso obrigatório do relatório preventivo (prompt §40). */
export function ReportDisclaimer() {
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-surface-muted px-3.5 py-3 text-sm text-muted">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>Este relatório tem finalidade informativa e não constitui diagnóstico médico.</span>
    </p>
  )
}
