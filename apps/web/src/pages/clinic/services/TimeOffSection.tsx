import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Palmtree, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatShortDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import type { ClinicProfessional, ClinicTimeOff, TimeOffResult } from '@/types/clinic'

/** Dia local (yyyy-mm-dd) + deslocamento em dias → instante ISO à meia-noite local. */
function midnight(day: string, plusDays = 0): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d + plusDays).toISOString()
}

interface FormProps {
  professionals: ClinicProfessional[]
  onClose: () => void
  onCreated: (result: TimeOffResult) => void
}

function TimeOffForm({ professionals, onClose, onCreated }: FormProps) {
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? '')
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!professionalId) return setError('Escolha o profissional.')
    if (!from || !to || to < from) return setError('O último dia não pode ser antes do primeiro.')
    setSaving(true)
    try {
      // Dias inteiros: do início do primeiro dia ao fim do último (inclusivo).
      onCreated(
        await clinicCatalogService.createTimeOff({
          professionalId,
          startsAt: midnight(from),
          endsAt: midnight(to, 1),
          reason: reason.trim() || undefined,
        }),
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novas férias ou bloqueio"
      description="Os horários livres desses dias são removidos e deixam de ser criados."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Bloquear
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select label="Profissional" options={professionals.map((p) => ({ value: p.id, label: p.name }))} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Primeiro dia" type="date" min={todayISO()} value={from} onChange={(e) => { setFrom(e.target.value); setError(null) }} />
          <Input label="Último dia" type="date" min={from || todayISO()} value={to} onChange={(e) => { setTo(e.target.value); setError(null) }} />
        </div>
        <Input label="Motivo (opcional)" placeholder="Ex.: Férias" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} hint="Só a clínica vê esta nota." />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

function ResultModal({ result, onClose }: { result: TimeOffResult; onClose: () => void }) {
  const booked = result.bookedSlots
  return (
    <Modal open onClose={onClose} title="Bloqueio registado" footer={<Button onClick={onClose}>Entendi</Button>}>
      <div className="flex flex-col gap-3 text-sm">
        <p>{formatCount(result.removedSlots, 'horário livre foi removido', 'horários livres foram removidos')}.</p>
        {booked.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-warning">
            <p className="font-medium">
              {formatCount(booked.length, 'horário já tem marcações e não foi removido', 'horários já têm marcações e não foram removidos')}. As marcações não foram canceladas: trate-as no{' '}
              <Link to={paths.clinicAgenda} className="underline">
                Calendário
              </Link>
              .
            </p>
            <ul className="list-disc pl-5">
              {booked.map((slot) => (
                <li key={slot.slotId}>
                  {formatShortDate(slot.startsAt)} às {formatTime(slot.startsAt)} · {slot.kind === 'EXAM' ? 'exame' : 'consulta'} ·{' '}
                  {formatCount(slot.bookedCount, 'marcação', 'marcações')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

interface SectionProps {
  professionals: ClinicProfessional[]
  /** Chamado quando os horários podem ter mudado (para recarregar o resto do ecrã). */
  onChanged: () => void
}

/** Férias e bloqueios por profissional (BR-CLN-14). */
export function TimeOffSection({ professionals, onChanged }: SectionProps) {
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicCatalogService.listTimeOff(), [])
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<TimeOffResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const active = professionals.filter((p) => p.active)
  const name = (id: string) => professionals.find((p) => p.id === id)?.name ?? 'Profissional'

  async function remove(timeOff: ClinicTimeOff) {
    setBusy(timeOff.id)
    try {
      const generation = await clinicCatalogService.deleteTimeOff(timeOff.id)
      toast.show(`Bloqueio removido. ${formatCount(generation.created, 'horário recriado', 'horários recriados')}.`)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(null)
      reload()
      onChanged()
    }
  }

  const newButton = (
    <Button size="sm" variant="secondary" onClick={() => setCreating(true)} disabled={active.length === 0} icon={<Plus className="size-4" aria-hidden />}>
      Novas férias ou bloqueio
    </Button>
  )

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">Férias e bloqueios</h2>
        {state.status === 'success' && state.data.length > 0 && newButton}
      </div>
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (state.data.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {state.data.map((timeOff) => (
              <div key={timeOff.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name(timeOff.professionalId)}</span>
                  <span className="block text-sm text-muted">
                    {formatShortDate(timeOff.startsAt)} a {formatShortDate(new Date(Date.parse(timeOff.endsAt) - 1).toISOString())}
                    {timeOff.reason ? ` · ${timeOff.reason}` : ''}
                  </span>
                  {timeOff.bookedSlotCount > 0 && (
                    <span className="mt-1 block">
                      <Badge tone="warning" dot>
                        {formatCount(timeOff.bookedSlotCount, 'horário com marcações', 'horários com marcações')} · trate no Calendário
                      </Badge>
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy === timeOff.id}
                  onClick={() => void remove(timeOff)}
                  aria-label={`Remover bloqueio de ${name(timeOff.professionalId)}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState
            icon={Palmtree}
            title="Sem férias nem bloqueios."
            description="Marque aqui os dias em que um profissional não atende."
            action={newButton}
          />
        ))}

      {creating && (
        <TimeOffForm
          professionals={active}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false)
            setResult(created)
            reload()
            onChanged()
          }}
        />
      )}
      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
    </section>
  )
}
