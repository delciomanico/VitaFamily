import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CalendarDays, FlaskConical, Search, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { isAppError } from '@/lib/errors'
import { formatWhen } from '@/lib/format'
import { appointmentStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import { CLINIC_SEARCH_MIN, type ClinicCalendarEntry } from '@/types/clinic'

const SEARCH_DELAY_MS = 250

/** Foco no atalho `/` só quando o utilizador não está a escrever noutro campo ou num diálogo. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('dialog[open]') !== null
}

function BookingLink({ entry, onNavigate }: { entry: ClinicCalendarEntry; onNavigate: () => void }) {
  const status = appointmentStatus[entry.status]
  const Icon = entry.kind === 'EXAM' ? FlaskConical : CalendarDays
  return (
    <Link
      to={entry.clinicPatientId ? paths.clinicPatient(entry.clinicPatientId) : paths.clinicAgenda}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-muted"
    >
      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{entry.patientName}</span>
        <span className="block truncate text-xs text-muted">
          {formatWhen(entry.startsAt)}
          {entry.specialty ? ` · ${entry.specialty}` : ''}
          {entry.professionalName ? ` · ${entry.professionalName}` : ''}
        </span>
      </span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </Link>
  )
}

/**
 * Pesquisa global do portal (UC-CLN-18, BR-CLN-22): um só campo, com painel de resultados —
 * pacientes e marcações da própria clínica. Atalho `/`. Nunca pesquisa a base Vita.
 */
export function ClinicSearch() {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { pathname } = useLocation()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [q])

  // O atalho `/` foca o campo; Esc e clique fora fecham o painel.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  // Navegar fecha o painel.
  useEffect(() => setOpen(false), [pathname])

  const searchable = term.length >= CLINIC_SEARCH_MIN
  const { state } = useAsync(
    () => (searchable ? clinicPatientsService.search(term) : Promise.resolve(null)),
    [term, searchable],
  )
  const close = () => {
    setOpen(false)
    setQ('')
    setTerm('')
  }
  const showPanel = open && q.trim().length > 0

  return (
    <div ref={rootRef} className="relative w-full max-w-xl" role="search">
      <label htmlFor={`${panelId}-input`} className="sr-only">
        Pesquisar pacientes e marcações
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2 text-muted" aria-hidden />
      <input
        id={`${panelId}-input`}
        ref={inputRef}
        type="search"
        autoComplete="off"
        placeholder="Pesquisar paciente ou marcação"
        value={q}
        onChange={(event) => {
          setQ(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
        aria-expanded={showPanel}
        aria-controls={panelId}
        className="h-11 w-full rounded-full border border-border bg-surface pr-12 pl-11 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded border border-border bg-surface-muted px-1.5 text-xs text-muted lg:block"
      >
        /
      </kbd>

      {showPanel && (
        <div
          id={panelId}
          aria-live="polite"
          className={cn(
            'absolute top-full right-0 left-0 z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-overlay',
          )}
        >
          {!searchable && <p className="px-3 py-2 text-sm text-muted">Escreva pelo menos 2 letras.</p>}
          {searchable && state.status === 'loading' && <p className="px-3 py-2 text-sm text-muted">A pesquisar…</p>}
          {searchable && state.status === 'error' && (
            <p role="alert" className="px-3 py-2 text-sm text-danger">
              {isAppError(state.error, 'RATE_LIMITED')
                ? 'Fez demasiadas pesquisas. Tente mais tarde.'
                : 'Não foi possível pesquisar. Tente novamente.'}
            </p>
          )}
          {searchable && state.status === 'success' && state.data && (
            <>
              {state.data.patients.length === 0 && state.data.bookings.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted">
                  Sem resultados. A pesquisa é no registo da clínica; para um paciente Vita use o código ou o e-mail ao marcar.
                </p>
              )}
              {state.data.patients.length > 0 && (
                <section aria-label="Pacientes">
                  <h2 className="px-3 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Pacientes</h2>
                  {state.data.patients.map((patient) => (
                    <Link
                      key={patient.id}
                      to={paths.clinicPatient(patient.id)}
                      onClick={close}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-muted"
                    >
                      <UserRound className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{patient.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {[patient.phone, patient.email].filter(Boolean).join(' · ') || 'Sem contacto'}
                        </span>
                      </span>
                      {patient.vitaLink && <Badge tone="primary">Vita</Badge>}
                    </Link>
                  ))}
                </section>
              )}
              {state.data.bookings.length > 0 && (
                <section aria-label="Marcações">
                  <h2 className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Marcações</h2>
                  {state.data.bookings.map((entry) => (
                    <BookingLink key={entry.id} entry={entry} onNavigate={close} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
