import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { paths } from '@/routes/paths'
import { UnreadAlertsContext } from './UnreadAlertsContext'

/** Sino da faixa (telemóvel/tablet): abre os alertas; no desktop os alertas estão na sidebar. */
export function AlertsButton() {
  const unread = useContext(UnreadAlertsContext)
  return (
    <Link
      to={paths.alerts}
      aria-label={unread > 0 ? `Alertas, ${unread} por ler` : 'Alertas'}
      className="relative -mr-2 flex size-12 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15 lg:hidden"
    >
      <Bell className="size-6" aria-hidden />
      {unread > 0 && <span className="absolute top-2.5 right-3 size-3 rounded-full bg-danger ring-2 ring-brand" />}
    </Link>
  )
}
