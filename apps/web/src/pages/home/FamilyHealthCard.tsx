import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Card, Section } from '@/components/ui/Card'
import { formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

/** Resumo da família: só contagens, sem interpretação clínica (UC-RPT-02). */
export function FamilyHealthCard({ family }: { family: HomeSummary['family'] }) {
  const upToDate = family.tracked - family.withPending

  return (
    <Section title="Saúde da família">
      <Card className="flex flex-1 flex-col gap-4">
        <p className="font-medium">{formatCount(family.tracked, 'membro acompanhado', 'membros acompanhados')}</p>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" aria-hidden />
            {upToDate} em dia
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            {formatCount(family.withPending, 'acompanhamento pendente', 'acompanhamentos pendentes')}
          </li>
        </ul>
        <Link
          to={paths.familyReport}
          className="mt-auto inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          Ver relatório
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    </Section>
  )
}
