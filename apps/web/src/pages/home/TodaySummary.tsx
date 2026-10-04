import { FlaskConical, Pill, Users } from 'lucide-react'
import { Card, Section } from '@/components/ui/Card'
import { formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'
import { SummaryRow } from './SummaryRow'

export function TodaySummary({ today }: { today: HomeSummary['today'] }) {
  return (
    <Section title="Hoje">
      <Card className="py-1">
        <SummaryRow
          to={paths.medications}
          icon={Pill}
          label="Medicamentos"
          value={today.pendingDoses > 0 ? formatCount(today.pendingDoses, 'lembrete', 'lembretes') : 'Sem tomas pendentes'}
        />
        <SummaryRow
          to={paths.examinations}
          icon={FlaskConical}
          label="Exames"
          value={today.newResults > 0 ? formatCount(today.newResults, 'resultado novo', 'resultados novos') : 'Sem resultados novos'}
        />
        <SummaryRow to={paths.family} icon={Users} label="Família" value={formatCount(today.members, 'membro', 'membros')} />
      </Card>
    </Section>
  )
}
