import { formatLongDate, formatTime } from '@/lib/format'
import type { ConsultationReportAddendum } from '@/types/clinicReport'

/** Adendas datadas e imutáveis de um relatório FINAL (BR-CLN-43). */
export function ReportAddendaList({ addenda }: { addenda: ConsultationReportAddendum[] }) {
  if (addenda.length === 0) return null
  return (
    <ul aria-label="Adendas" className="flex flex-col gap-3">
      {addenda.map((addendum) => (
        <li key={addendum.id} className="rounded-xl bg-surface-muted p-3.5">
          <p className="text-sm font-medium">
            {formatLongDate(addendum.createdAt)} · {formatTime(addendum.createdAt)} · {addendum.authorName}
          </p>
          <p className="mt-1 whitespace-pre-line">{addendum.text}</p>
        </li>
      ))}
    </ul>
  )
}
