import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CalendarDays, FlaskConical, Inbox, Search, UserPlus } from 'lucide-react'
import { ClinicStatsBar } from '@/components/clinic/ClinicStatsBar'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { formatLongDate, formatTime, formatWhen } from '@/lib/format'
import { appointmentStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicPortalService } from '@/services/clinicPortal.service'

interface DayItem {
  id: string
  at: string
  kind: 'CONSULTA' | 'EXAME'
  patientName: string
  label?: string
  status: 'REQUESTED' | 'SCHEDULED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
}

/** Quantos pedidos se mostram na lista curta; os restantes ficam em "Ver todos". */
const PENDING_PREVIEW = 5

/**
 * Página inicial do portal (docs/11-implementation/clinic-portal-v2.md, "Hoje"): o que a clínica tem
 * de fazer agora — pedidos por responder, o dia por ordem cronológica e as ações mais frequentes.
 */
export function ClinicTodayPage() {
  const toast = useToast()
  const [walkIn, setWalkIn] = useState(false)
  const { state, reload } = useAsync(async () => {
    const [requests, agenda, exams, slots, services] = await Promise.all([
      clinicPortalService.listRequests(),
      clinicPortalService.listAgenda(),
      clinicPortalService.listExamAgenda(),
      clinicPortalService.listSlots(),
      // Aviso opcional: se o catálogo falhar, a página "Hoje" continua a funcionar sem ele.
      clinicCatalogService.listServices({ active: true }).catch(() => null),
    ])
    const today = todayISO()
    const dayItems: DayItem[] = [
      ...agenda
        .filter((b) => localDay(b.scheduledAt) === today && b.status !== 'CANCELLED')
        .map((b): DayItem => ({
          id: b.id,
          at: b.scheduledAt,
          kind: 'CONSULTA',
          patientName: b.patientName,
          label: b.specialty,
          status: b.status,
        })),
      ...exams
        .filter((b) => localDay(b.scheduledAt) === today && b.status !== 'CANCELLED')
        .map((b): DayItem => ({
          id: b.id,
          at: b.scheduledAt,
          kind: 'EXAME',
          patientName: b.patientName,
          label: b.examType,
          status: b.status,
        })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    return {
      requests,
      dayItems,
      freeSlots: slots.reduce((sum, slot) => sum + slot.remaining, 0),
      noServices: services !== null && services.length === 0,
    }
  }, [])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Hoje</h1>
          <p className="text-sm text-muted first-letter:uppercase">{formatLongDate(new Date().toISOString())}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setWalkIn(true)} icon={<UserPlus className="size-4" aria-hidden />}>
            Consulta presencial
          </Button>
          <Link to={paths.clinicPatients}>
            <Button size="sm" variant="secondary" icon={<Search className="size-4" aria-hidden />}>
              Pesquisar paciente
            </Button>
          </Link>
          <Link to={paths.clinicSlots}>
            <Button size="sm" variant="secondary" icon={<CalendarClock className="size-4" aria-hidden />}>
              Novo horário
            </Button>
          </Link>
        </div>
      </div>

      <ClinicStatsBar />

      {state.status === 'success' && state.data.noServices && (
        <Card className="flex flex-wrap items-center justify-between gap-3 bg-warning-soft">
          <p className="text-sm text-warning">
            Ainda não configurou serviços. Adicione os serviços e os profissionais para criar horários automáticos.
          </p>
          <Link to={paths.clinicServices} className="text-sm font-medium text-primary">
            Configurar serviços
          </Link>
        </Card>
      )}

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-6">
          <DetailSection title="O dia">
            {state.data.dayItems.length > 0 ? (
              <Card className="divide-y divide-border py-1">
                {state.data.dayItems.map((item) => {
                  const status = appointmentStatus[item.status]
                  return (
                    <div key={`${item.kind}-${item.id}`} className="flex items-center gap-3 py-3">
                      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{formatTime(item.at)}</span>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                        {item.kind === 'EXAME' ? (
                          <FlaskConical className="size-4" aria-hidden />
                        ) : (
                          <CalendarDays className="size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.patientName}</p>
                        <p className="truncate text-sm text-muted">
                          {item.kind === 'EXAME' ? 'Exame' : 'Consulta'}
                          {item.label ? ` · ${item.label}` : ''}
                        </p>
                      </div>
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                    </div>
                  )
                })}
                <div className="flex justify-end gap-2 pt-3 pb-2">
                  <Link to={paths.clinicAgenda} className="text-sm font-medium text-primary">
                    Abrir calendário
                  </Link>
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="Sem consultas nem exames hoje."
                description={
                  state.data.freeSlots === 0
                    ? 'Não há vagas livres: publique horários para receber pedidos.'
                    : 'Marque uma consulta presencial ou aguarde pedidos.'
                }
              />
            )}
          </DetailSection>

          <DetailSection title={`Pedidos por responder (${state.data.requests.length})`}>
            {state.data.requests.length > 0 ? (
              <Card className="divide-y divide-border py-1">
                {state.data.requests.slice(0, PENDING_PREVIEW).map((request) => (
                  <div key={request.id} className="flex items-center gap-3 py-3">
                    <Inbox className="size-5 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{request.patientName}</p>
                      <p className="truncate text-sm text-muted">
                        {formatWhen(request.scheduledAt)}
                        {request.specialty ? ` · ${request.specialty}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-3 pb-2">
                  <Link to={paths.clinicRequests} className="text-sm font-medium text-primary">
                    {state.data.requests.length > PENDING_PREVIEW ? 'Ver todos e responder' : 'Responder'}
                  </Link>
                </div>
              </Card>
            ) : (
              <EmptyState icon={Inbox} title="Sem pedidos por responder." />
            )}
          </DetailSection>
        </div>
      )}

      {walkIn && (
        <WalkInBookingModal
          onClose={() => setWalkIn(false)}
          onBooked={() => {
            setWalkIn(false)
            toast.show('Consulta marcada.')
            reload()
          }}
        />
      )}
    </>
  )
}
