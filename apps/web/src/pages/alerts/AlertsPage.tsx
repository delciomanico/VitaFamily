import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check } from 'lucide-react'
import { AlertCard } from '@/components/domain/AlertCard'
import { Page } from '@/components/layout/Page'
import { RefreshUnreadAlertsContext } from '@/components/layout/UnreadAlertsContext'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { alertCategoryLabels, alertCategoryOf } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { alertService } from '@/services/alert.service'
import type { AlertCategory, AlertItem } from '@/types/alert'

type Filter = 'ALL' | AlertCategory

const filters: TabItem<Filter>[] = [
  { value: 'ALL', label: 'Todos' },
  ...(Object.keys(alertCategoryLabels) as AlertCategory[]).map((value) => ({
    value,
    label: alertCategoryLabels[value],
  })),
]

/** Recurso a que o alerta se refere: medicamento, consulta ou exame. */
function targetOf(alert: AlertItem): string | undefined {
  if (!alert.targetId) return undefined
  switch (alert.sourceType) {
    case 'DOSE':
      return paths.medication(alert.targetId)
    case 'APPOINTMENT':
      return paths.appointment(alert.targetId)
    case 'EXAMINATION':
      return paths.examination(alert.targetId)
  }
}

interface AlertRowsProps {
  alerts: AlertItem[]
  onOpen: (alert: AlertItem) => void
  onRead?: (alert: AlertItem) => void
}

function AlertRows({ alerts, onOpen, onRead }: AlertRowsProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(alert)}
            className="-ml-2 min-w-0 flex-1 rounded-md px-2 text-left transition-colors hover:bg-surface-muted"
          >
            <AlertCard alert={alert} dot={!onRead} />
          </button>
          {onRead && (
            <button
              type="button"
              onClick={() => onRead(alert)}
              aria-label="Marcar como lido"
              title="Marcar como lido"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary-soft"
            >
              <Check className="size-5" aria-hidden />
            </button>
          )}
        </div>
      ))}
    </Card>
  )
}

/** Centro de alertas (UC-ALR-03/04): por ler primeiro, filtro por categoria, marcar como lido. */
export function AlertsPage() {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const refreshUnread = useContext(RefreshUnreadAlertsContext)
  const [filter, setFilter] = useState<Filter>('ALL')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => alertService.listAlerts(familyId, userId), [familyId, userId])

  async function run(action: Promise<void>) {
    try {
      await action
      reload()
      refreshUnread()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  function open(alert: AlertItem) {
    if (!alert.readAt) void alertService.markAlertRead(familyId, userId, alert.id).then(refreshUnread)
    const target = targetOf(alert)
    if (target) navigate(target)
  }

  const alerts =
    state.status === 'success' ? state.data.filter((a) => filter === 'ALL' || alertCategoryOf[a.type] === filter) : []
  const unread = alerts.filter((a) => !a.readAt)
  const read = alerts.filter((a) => a.readAt)

  return (
    <Page title="Alertas" backTo={paths.home} backLabel="Início">
      <Tabs label="Filtrar alertas" items={filters} value={filter} onChange={setFilter} scrollable />
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <div role="tabpanel" className="flex flex-col gap-5">
          {alerts.length === 0 && (
            <EmptyState
              icon={Bell}
              title={filter === 'ALL' ? 'Sem alertas.' : `Sem alertas de ${alertCategoryLabels[filter].toLowerCase()}.`}
              description="Os lembretes de tomas, consultas e exames aparecem aqui."
            />
          )}
          {unread.length > 0 && (
            <DetailSection
              title={`Por ler (${unread.length})`}
              action={
                filter === 'ALL' && (
                <button
                  type="button"
                  onClick={() => run(alertService.markAllAlertsRead(familyId, userId))}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Marcar todos como lidos
                </button>
                )
              }
            >
              <AlertRows
                alerts={unread}
                onOpen={open}
                onRead={(alert) => run(alertService.markAlertRead(familyId, userId, alert.id))}
              />
            </DetailSection>
          )}
          {read.length > 0 && (
            <DetailSection title="Lidos">
              <AlertRows alerts={read} onOpen={open} />
            </DetailSection>
          )}
        </div>
      )}
    </Page>
  )
}
