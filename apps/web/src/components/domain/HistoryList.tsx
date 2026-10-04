import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronRight, FileText, FlaskConical, Stethoscope, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatDayMonth } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HistoryEntry, HistoryEntryKind } from '@/types/history'

const icons: Record<HistoryEntryKind, LucideIcon> = {
  APPOINTMENT: CalendarDays,
  EXAMINATION: FlaskConical,
  PRESCRIPTION: FileText,
  HISTORY: Stethoscope,
}

/** Detalhe de cada entrada; antecedentes (HISTORY) não têm página própria. */
function linkTo({ kind, id }: HistoryEntry): string | null {
  switch (kind) {
    case 'APPOINTMENT':
      return paths.appointment(id)
    case 'EXAMINATION':
      return paths.examination(id)
    case 'PRESCRIPTION':
      return paths.prescription(id)
    case 'HISTORY':
      return null
  }
}

function groupByYear(entries: HistoryEntry[]): Array<[string, HistoryEntry[]]> {
  const groups = new Map<string, HistoryEntry[]>()
  for (const entry of entries) {
    const year = entry.date.slice(0, 4)
    groups.set(year, [...(groups.get(year) ?? []), entry])
  }
  return [...groups]
}

function Row({ entry }: { entry: HistoryEntry }) {
  const Icon = icons[entry.kind]
  const to = linkTo(entry)
  const body: ReactNode = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{entry.title}</span>
        {entry.subtitle && <span className="block truncate text-sm text-muted">{entry.subtitle}</span>}
      </span>
      <span className="shrink-0 text-sm text-muted">{formatDayMonth(entry.date)}</span>
      {to && <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />}
    </>
  )
  const classes = '-mx-2 flex items-center gap-3 rounded-md px-2 py-3'
  return to ? (
    <Link to={to} className={`${classes} transition-colors hover:bg-surface-muted`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  )
}

/** Histórico agrupado por ano, do mais recente para o mais antigo. */
export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="flex flex-col gap-6">
      {groupByYear(entries).map(([year, items]) => (
        <section key={year} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{year}</h2>
          <Card className="divide-y divide-border py-1">
            {items.map((entry) => (
              <Row key={`${entry.kind}-${entry.id}`} entry={entry} />
            ))}
          </Card>
        </section>
      ))}
    </div>
  )
}
