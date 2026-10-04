import { Link } from 'react-router-dom'
import { AlertCard } from '@/components/domain/AlertCard'
import { Card, Section } from '@/components/ui/Card'
import { paths } from '@/routes/paths'
import type { AlertItem } from '@/types/alert'

/** Alertas por ler. Não aparece quando não há nada a pedir atenção. */
export function ImportantAlerts({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null

  return (
    <Section
      title="Precisa da sua atenção"
      action={
        <Link to={paths.alerts} className="text-sm font-medium text-primary hover:underline">
          Ver todos
        </Link>
      }
    >
      <Card className="divide-y divide-border py-0">
        {alerts.map((alert) => (
          <Link key={alert.id} to={paths.alerts} className="block">
            <AlertCard alert={alert} />
          </Link>
        ))}
      </Card>
    </Section>
  )
}
