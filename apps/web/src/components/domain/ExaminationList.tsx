import { FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { firstName } from '@/lib/date'
import { formatCount, formatShortDate } from '@/lib/format'
import { examinationStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import type { ExaminationSummary } from '@/types/examination'

interface ExaminationListProps {
  items: ExaminationSummary[]
  /** Membro do próprio utilizador: o nome só aparece nos exames de outros. */
  selfMemberId?: string
  /** Falso = só leitura (perfil de um membro que partilha, sem acesso ao detalhe). */
  linked?: boolean
}

/** Exames numa só lista: nome, data, número de resultados e estado. */
export function ExaminationList({ items, selfMemberId, linked = true }: ExaminationListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map(({ examination, memberName, resultCount }) => {
        const status = examinationStatus[examination.status]
        const results =
          examination.status === 'COMPLETED'
            ? resultCount > 0
              ? formatCount(resultCount, 'resultado', 'resultados')
              : 'Sem resultados'
            : null
        return (
          <RowLink key={examination.id} to={paths.examination(examination.id)} linked={linked}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <FlaskConical className="size-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">
                {examination.name}
                {examination.memberId !== selfMemberId && (
                  <span className="font-normal text-muted"> · {firstName(memberName)}</span>
                )}
              </span>
              <span className="truncate text-sm text-muted">
                {[formatShortDate(examination.examDate), results].filter(Boolean).join(' · ')}
              </span>
              <Badge tone={status.tone} dot className="mt-0.5 w-fit">
                {status.label}
              </Badge>
            </span>
          </RowLink>
        )
      })}
    </Card>
  )
}
