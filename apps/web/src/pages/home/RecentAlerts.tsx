import { Link } from 'react-router-dom'
import { AlertCard } from '@/components/domain/AlertCard'
import { useFitCount } from '@/hooks/useFitCount'
import { paths } from '@/routes/paths'
import type { AlertItem } from '@/types/alert'

/** Altura de cada linha de alerta compacta (px); tem de corresponder a `h-14`. */
const ROW_HEIGHT = 56

/**
 * Alertas recentes (“Existe algo que precisa da minha atenção?”).
 * Ocupa a altura disponível e mostra só as linhas que cabem inteiras; o resto está em “Ver todos”.
 */
export function RecentAlerts({ alerts }: { alerts: AlertItem[] }) {
  const { ref, count } = useFitCount<HTMLUListElement>(ROW_HEIGHT)
  const visible = alerts.slice(0, count)

  return (
    <section
      aria-labelledby="recent-alerts"
      className="fit-hide-alerts flex h-full min-h-0 flex-col rounded-xl border border-border bg-surface px-3.5 pt-3 pb-1 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="recent-alerts" className="text-sm font-semibold">
          Alertas recentes
        </h2>
        <Link to={paths.alerts} className="text-sm font-medium text-primary hover:underline">
          Ver todos{alerts.length > visible.length ? ` (${alerts.length})` : ''}
        </Link>
      </div>
      {alerts.length === 0 ? (
        <p className="py-3 text-sm text-muted">Sem alertas recentes.</p>
      ) : (
        <ul ref={ref} className="min-h-0 flex-1 divide-y divide-border overflow-hidden">
          {visible.map((alert) => (
            <li key={alert.id} className="h-14">
              <Link to={paths.alerts} className="block">
                <AlertCard alert={alert} compact />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
