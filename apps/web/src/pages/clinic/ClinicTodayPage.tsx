import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CalendarDays, FlaskConical, Inbox, Phone, Repeat, Search, UserPlus } from 'lucide-react'
import { BookingDayActions } from '@/components/clinic/BookingDayActions'
import { ConfirmationBadge } from '@/components/clinic/ConfirmationBadge'
import { FollowUpModal } from '@/components/clinic/FollowUpModal'
import { ClinicStatsBar } from '@/components/clinic/ClinicStatsBar'
import { IssueReceiptModal } from '@/components/clinic/IssueReceiptModal'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { formatDayMonth, formatLongDate, formatTime, formatWhen } from '@/lib/format'
import { dayStateLabel } from '@/lib/clinicDay'
import { errorMessage } from '@/lib/errors'
import { appointmentStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { useNavigate } from 'react-router-dom'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicDayService } from '@/services/clinicDay.service'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking, ClinicFollowUp } from '@/types/clinic'
import { CompleteConsultationForm } from './CompleteConsultationForm'

interface DayItem {
  id: string
  at: string
  kind: 'CONSULTA' | 'EXAME'
  patientName: string
  label?: string
  status: 'REQUESTED' | 'SCHEDULED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  /** Consulta Vita ou visita manual (M14 Q: fila do dia); ausente em exames. */
  booking?: ClinicBooking
}

interface DayRowProps {
  item: DayItem
  onChanged: () => void
  onComplete: (booking: ClinicBooking) => void
  onFollowUp: (booking: ClinicBooking) => void
}

/** Uma linha da fila do dia (M14 Q): hora, paciente, estado derivado, confirmação e ações de um toque. */
function DayRow({ item, onChanged, onComplete, onFollowUp }: DayRowProps) {
  const { booking } = item
  const declined = booking?.status === 'CANCELLED' && booking.confirmationStatus === 'DECLINED'
  const state = booking?.dayState ?? item.status
  const status = booking ? dayStateLabel[state] : appointmentStatus[item.status]
  const label =
    state === 'ARRIVED' && booking?.waitingMinutes != null
      ? `${status.label} · ${booking.waitingMinutes} min`
      : status.label
  return (
    <div className={`flex flex-col gap-2 py-3 ${declined ? 'opacity-80' : ''}`}>
      <div className="flex items-center gap-3">
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
            {booking?.source === 'MANUAL' ? 'Visita presencial' : item.kind === 'EXAME' ? 'Exame' : 'Consulta'}
            {item.label ? ` · ${item.label}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {declined ? (
            <Badge tone="danger" dot>
              Recusou – horário livre
            </Badge>
          ) : (
            <>
              <Badge tone={status.tone} dot>
                {label}
              </Badge>
              {booking && (
                <ConfirmationBadge
                  status={booking.status}
                  confirmationStatus={booking.confirmationStatus}
                  confirmationSource={booking.confirmationSource}
                />
              )}
            </>
          )}
        </div>
      </div>
      {booking && !declined && (
        <div className="sm:pl-27">
          <BookingDayActions booking={booking} onChanged={onChanged} onComplete={onComplete} onFollowUp={onFollowUp} />
        </div>
      )}
    </div>
  )
}

/** Retornos por contactar (BR-CLN-30): visitas manuais e consultas Vita com retorno por tratar. */
function FollowUps({ items, onChanged }: { items: ClinicFollowUp[]; onChanged: () => void }) {
  const toast = useToast()
  async function done(item: ClinicFollowUp) {
    try {
      await clinicDayService.clearFollowUp(item.bookingId)
      toast.show('Retorno tratado.')
      onChanged()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }
  return (
    <DetailSection title={`Retornos a contactar (${items.length})`}>
      {items.length > 0 ? (
        <Card className="divide-y divide-border py-1">
          {items.map((item) => (
            <div key={item.bookingId} className="flex items-center gap-3 py-3">
              <Repeat className="size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.patientName}</p>
                <p className="truncate text-sm text-muted">
                  Voltar até {formatDayMonth(item.dueOn)}
                  {item.source === 'VITA' && item.patientNotified ? ' · avisado na app' : ''}
                </p>
                {item.patientPhone && (
                  <a href={`tel:${item.patientPhone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-sm text-primary">
                    <Phone className="size-3.5" aria-hidden />
                    {item.patientPhone}
                  </a>
                )}
              </div>
              <Button size="sm" variant="soft" onClick={() => void done(item)}>
                Já tratado
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={Repeat} title="Sem retornos a contactar." />
      )}
    </DetailSection>
  )
}

/** Quantos pedidos se mostram na lista curta; os restantes ficam em "Ver todos". */
const PENDING_PREVIEW = 5

/**
 * Página inicial do portal (docs/11-implementation/clinic-portal-v2.md, "Hoje"): o que a clínica tem
 * de fazer agora — pedidos por responder, o dia por ordem cronológica e as ações mais frequentes.
 */
export function ClinicTodayPage() {
  const toast = useToast()
  const navigate = useNavigate()
  // O Médico só vê o seu dia: sem pedidos, vagas, serviços nem marcação presencial (BR-CLN-39).
  const { isDoctor } = useClinicAuth()
  const [walkIn, setWalkIn] = useState(false)
  const [completing, setCompleting] = useState<ClinicBooking | null>(null)
  const [receiptFor, setReceiptFor] = useState<ClinicBooking | null>(null)
  const [followingUp, setFollowingUp] = useState<ClinicBooking | null>(null)
  const { state, reload } = useAsync(async () => {
    const [requests, agenda, exams, slots, services, followUps] = await Promise.all([
      isDoctor ? Promise.resolve([]) : clinicPortalService.listRequests(),
      clinicPortalService.listAgenda(),
      clinicPortalService.listExamAgenda(),
      isDoctor ? Promise.resolve([]) : clinicPortalService.listSlots(),
      // Aviso opcional: se o catálogo falhar, a página "Hoje" continua a funcionar sem ele.
      isDoctor ? Promise.resolve(null) : clinicCatalogService.listServices({ active: true }).catch(() => null),
      // Idem para os retornos a contactar (M14 Q).
      clinicDayService.listFollowUps().catch((): ClinicFollowUp[] => []),
    ])
    const today = todayISO()
    const dayItems: DayItem[] = [
      ...agenda
        // As canceladas ficam de fora, menos as que o paciente recusou ("Não posso"): o horário está livre.
        .filter(
          (b) =>
            localDay(b.scheduledAt) === today && (b.status !== 'CANCELLED' || b.confirmationStatus === 'DECLINED'),
        )
        .map((b): DayItem => ({
          id: b.id,
          at: b.scheduledAt,
          kind: 'CONSULTA',
          patientName: b.patientName,
          label: b.specialty,
          status: b.status,
          booking: b,
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
      waiting: dayItems.filter((i) => i.booking?.dayState === 'ARRIVED').length,
      followUps,
      freeSlots: slots.reduce((sum, slot) => sum + slot.remaining, 0),
      noServices: services !== null && services.length === 0,
    }
  }, [isDoctor])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Hoje</h1>
          <p className="text-sm text-muted first-letter:uppercase">{formatLongDate(new Date().toISOString())}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isDoctor && (
            <Button size="sm" onClick={() => setWalkIn(true)} icon={<UserPlus className="size-4" aria-hidden />}>
              Consulta presencial
            </Button>
          )}
          <Link to={paths.clinicPatients}>
            <Button size="sm" variant="secondary" icon={<Search className="size-4" aria-hidden />}>
              Pesquisar paciente
            </Button>
          </Link>
          {!isDoctor && (
            <Link to={paths.clinicSlots}>
              <Button size="sm" variant="secondary" icon={<CalendarClock className="size-4" aria-hidden />}>
                Novo horário
              </Button>
            </Link>
          )}
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
                {state.data.waiting > 0 && (
                  <p className="py-2 text-sm font-medium text-warning">
                    {state.data.waiting} {state.data.waiting === 1 ? 'paciente em espera' : 'pacientes em espera'}
                  </p>
                )}
                {state.data.dayItems.map((item) => (
                  <DayRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onChanged={reload}
                    onComplete={setCompleting}
                    onFollowUp={setFollowingUp}
                  />
                ))}
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
                  isDoctor
                    ? 'A sua agenda de hoje está vazia.'
                    : state.data.freeSlots === 0
                      ? 'Não há vagas livres: publique horários para receber pedidos.'
                      : 'Marque uma consulta presencial ou aguarde pedidos.'
                }
              />
            )}
          </DetailSection>

          {!isDoctor && (
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
          )}

          <FollowUps items={state.data.followUps} onChanged={reload} />
        </div>
      )}

      {completing && (
        <CompleteConsultationForm
          booking={completing}
          onClose={() => setCompleting(null)}
          onCompleted={() => {
            const done = completing
            setCompleting(null)
            toast.show('Consulta concluída.')
            reload()
            // Ao concluir, oferece-se logo o recibo (um toque); o Médico não emite (BR-CLN-39).
            if (!isDoctor) setReceiptFor(done)
          }}
        />
      )}

      {receiptFor && (
        <IssueReceiptModal
          bookingKind={receiptFor.source === 'MANUAL' ? 'VISIT' : 'APPOINTMENT'}
          bookingId={receiptFor.id}
          patientName={receiptFor.patientName}
          serviceName={receiptFor.specialty}
          onClose={() => setReceiptFor(null)}
          onIssued={(receipt) => {
            setReceiptFor(null)
            toast.show('Recibo emitido.')
            navigate(paths.clinicReceipt(receipt.id))
          }}
        />
      )}

      {followingUp && (
        <FollowUpModal
          booking={followingUp}
          onClose={() => setFollowingUp(null)}
          onSaved={() => {
            setFollowingUp(null)
            toast.show('Retorno registado.')
            reload()
          }}
        />
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
