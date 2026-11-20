import { Link } from 'react-router-dom'
import { AlertCard } from '@/components/domain/AlertCard'
import { paths } from '@/routes/paths'
import type { AlertItem } from '@/types/alert'

/** Quantos alertas mostra o Início; o resto está em «Ver todos». */
const SHOWN = 3

/** Alertas recentes («Existe algo que precisa da minha atenção?»): só os últimos. */
export function RecentAlerts({ alerts }: { alerts: AlertItem[] }) {
  const visible = alerts.slice(0, SHOWN)
  return (
    <section aria-labelledby="recent-alerts" className="flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 pt-3 pb-2 shadow-card">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 id="recent-alerts" className="text-lg font-semibold">
          Alertas recentes
        </h2>
        <Link to={paths.alerts} className="flex min-h-11 items-center text-base font-medium text-primary hover:underline">
          Ver todos{alerts.length > visible.length ? ` (${alerts.length})` : ''}
        </Link>
      </div>
      {alerts.length === 0 ? (
        <p className="pb-2 text-base text-muted">Sem alertas recentes.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((alert) => (
            <li key={alert.id}>
              <Link to={paths.alerts} className="block min-h-14">
                <AlertCard alert={alert} compact />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
