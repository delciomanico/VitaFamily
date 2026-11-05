import { useLocation } from 'react-router-dom'
import { CalendarDays, FlaskConical, Inbox, Ticket } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { clinicPortalService } from '@/services/clinicPortal.service'

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-2xl leading-tight font-semibold tabular-nums">{value ?? '–'}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  )
}

/** Resumo do dia (só desktop): pedidos por responder, consultas e exames de hoje, vagas livres. Atualiza a cada navegação. */
export function ClinicStatsBar() {
  const { pathname } = useLocation()
  const { state } = useAsync(async () => {
    const [requests, agenda, exams, slots] = await Promise.all([
      clinicPortalService.listRequests(),
      clinicPortalService.listAgenda(),
      clinicPortalService.listExamAgenda(),
      clinicPortalService.listSlots(),
    ])
    const today = todayISO()
    return {
      requests: requests.length,
      consultations: agenda.filter((b) => b.status === 'SCHEDULED' && localDay(b.scheduledAt) === today).length,
      exams: exams.filter((b) => b.status === 'SCHEDULED' && localDay(b.scheduledAt) === today).length,
      freeSlots: slots.reduce((sum, slot) => sum + slot.remaining, 0),
    }
  }, [pathname])
  const data = state.status === 'success' ? state.data : null

  return (
    <section aria-label="Resumo" className="hidden grid-cols-4 gap-4 lg:grid">
      <Stat icon={Inbox} label="Pedidos por responder" value={data?.requests ?? null} />
      <Stat icon={CalendarDays} label="Consultas hoje" value={data?.consultations ?? null} />
      <Stat icon={FlaskConical} label="Exames hoje" value={data?.exams ?? null} />
      <Stat icon={Ticket} label="Vagas livres" value={data?.freeSlots ?? null} />
    </section>
  )
}
