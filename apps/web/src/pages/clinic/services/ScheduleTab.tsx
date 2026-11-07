import { useState } from 'react'
import { CalendarClock, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import {
  MAX_SLOT_CAPACITY,
  type ClinicProfessional,
  type ClinicScheduleRule,
  type ClinicServiceType,
  type ScheduleGeneration,
} from '@/types/clinic'
import { formatWeekdays, generationLines, WEEKDAY_SHORT } from './format'
import { TimeOffSection } from './TimeOffSection'

interface GenerationModalProps {
  title: string
  generation: ScheduleGeneration
  onClose: () => void
}

/** Resumo, em linguagem simples, do que a geração fez. */
function GenerationModal({ title, generation, onClose }: GenerationModalProps) {
  return (
    <Modal open onClose={onClose} title={title} footer={<Button onClick={onClose}>Entendi</Button>}>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
        {generationLines(generation).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Modal>
  )
}

interface RuleFormProps {
  professionals: ClinicProfessional[]
  services: ClinicServiceType[]
  onClose: () => void
  onCreated: (generation: ScheduleGeneration) => void
}

function RuleForm({ professionals, services, onClose, onCreated }: RuleFormProps) {
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? '')
  const [serviceTypeId, setServiceTypeId] = useState(services[0]?.id ?? '')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('13:00')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const service = services.find((s) => s.id === serviceTypeId)
  const isExam = service?.kind === 'EXAM'

  const toggle = (day: number) =>
    setWeekdays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()))

  async function save() {
    if (!professionalId || !service) return setError('Escolha o profissional e o serviço.')
    if (weekdays.length === 0) return setError('Escolha pelo menos um dia da semana.')
    if (!startTime || !endTime || endTime <= startTime) return setError('A hora de fim tem de ser depois da hora de início.')
    const [sh = 0, sm = 0] = startTime.split(':').map(Number)
    const [eh = 0, em = 0] = endTime.split(':').map(Number)
    if (eh * 60 + em - (sh * 60 + sm) < service.durationMinutes) {
      return setError(`O intervalo tem de caber pelo menos um serviço (${service.durationMinutes} min).`)
    }
    if (validFrom && validUntil && validUntil < validFrom) return setError('A data final não pode ser antes da inicial.')
    const slots = Number(capacity)
    if (isExam && (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOT_CAPACITY)) {
      return setError(`As vagas por horário têm de ser entre 1 e ${MAX_SLOT_CAPACITY}.`)
    }
    setSaving(true)
    try {
      const { generation } = await clinicCatalogService.createRule({
        professionalId,
        serviceTypeId,
        weekdays,
        startTime,
        endTime,
        validFrom: validFrom || undefined,
        validUntil: validUntil || undefined,
        capacity: isExam ? slots : 1,
      })
      onCreated(generation)
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
      title="Novos horários automáticos"
      description="Os horários são criados sozinhos para as próximas 8 semanas, um a seguir ao outro."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Criar e gerar horários
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <Select
          label="Profissional"
          options={professionals.map((p) => ({ value: p.id, label: p.name }))}
          value={professionalId}
          onChange={(e) => { setProfessionalId(e.target.value); setError(null) }}
        />
        <Select
          label="Serviço"
          options={services.map((s) => ({ value: s.id, label: `${s.name} (${s.durationMinutes} min)` }))}
          value={serviceTypeId}
          onChange={(e) => { setServiceTypeId(e.target.value); setError(null) }}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Dias da semana</span>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_SHORT.map((label, index) => {
              const day = index + 1
              const selected = weekdays.includes(day)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(day)}
                  className={cn(
                    'h-10 rounded-full border text-xs font-medium transition-colors',
                    selected ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Das" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="Até às" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="A partir de (opcional)" type="date" min={todayISO()} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          <Input label="Até ao dia (opcional)" type="date" min={validFrom || todayISO()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        {isExam && (
          <Input
            label="Vagas por horário"
            type="number"
            min={1}
            max={MAX_SLOT_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            hint="Quantos pacientes podem fazer o exame à mesma hora."
          />
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Horários automáticos (regras, BR-CLN-12) e férias/bloqueios (BR-CLN-14). */
export function ScheduleTab() {
  const toast = useToast()
  const { state, reload } = useAsync(async () => {
    const [rules, professionals, services] = await Promise.all([
      clinicCatalogService.listRules(),
      clinicCatalogService.listProfessionals(),
      clinicCatalogService.listServices(),
    ])
    return { rules, professionals, services }
  }, [])
  const [creating, setCreating] = useState(false)
  const [busyRule, setBusyRule] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ title: string; generation: ScheduleGeneration } | null>(null)

  async function run(rule: ClinicScheduleRule, title: string, action: () => Promise<{ generation: ScheduleGeneration }>) {
    setBusyRule(rule.id)
    try {
      setSummary({ title, generation: (await action()).generation })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusyRule(null)
      reload()
    }
  }

  if (state.status === 'loading') return <LoadingState rows={3} />
  if (state.status === 'error') return <ErrorState onRetry={reload} />

  const { rules, professionals, services } = state.data
  const activeProfessionals = professionals.filter((p) => p.active)
  const activeServices = services.filter((s) => s.active)
  const canCreate = activeProfessionals.length > 0 && activeServices.length > 0
  const professionalName = (id: string) => professionals.find((p) => p.id === id)?.name ?? 'Profissional'
  const service = (id: string) => services.find((s) => s.id === id)

  const newButton = (
    <Button size="sm" onClick={() => setCreating(true)} disabled={!canCreate} icon={<Plus className="size-4" aria-hidden />}>
      Novos horários automáticos
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted">Horários automáticos</h2>
          {rules.length > 0 && newButton}
        </div>
        {!canCreate && (
          <p className="rounded-md bg-warning-soft px-3.5 py-3 text-sm text-warning">
            Para criar horários automáticos precisa de, pelo menos, um profissional e um serviço ativos.
          </p>
        )}
        {rules.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {rules.map((rule) => {
              const svc = service(rule.serviceTypeId)
              const busy = busyRule === rule.id
              return (
                <div key={rule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {professionalName(rule.professionalId)} · {svc?.name ?? 'Serviço'}
                    </span>
                    <span className="block text-sm text-muted">
                      {formatWeekdays(rule.weekdays)} · {rule.startTime}–{rule.endTime}
                      {rule.validFrom ? ` · desde ${formatShortDate(rule.validFrom)}` : ''}
                      {rule.validUntil ? ` · até ${formatShortDate(rule.validUntil)}` : ''}
                      {rule.capacity > 1 ? ` · ${rule.capacity} vagas` : ''}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={rule.active ? 'success' : 'neutral'} dot>
                      {rule.active ? 'Ativo' : 'Desativado'}
                    </Badge>
                    {rule.active && (
                      <Button
                        size="sm"
                        variant="soft"
                        disabled={busy}
                        onClick={() => void run(rule, 'Horários atualizados', () => clinicCatalogService.regenerateRule(rule.id))}
                        icon={<RefreshCw className="size-4" aria-hidden />}
                      >
                        Atualizar horários
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={rule.active ? 'danger-ghost' : 'secondary'}
                      disabled={busy}
                      onClick={() =>
                        void run(rule, rule.active ? 'Regra desativada' : 'Regra reativada', () =>
                          clinicCatalogService.updateRule(rule.id, { active: !rule.active }),
                        )
                      }
                    >
                      {rule.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </Card>
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="Ainda não tem horários automáticos."
            description="Diga em que dias e horas cada profissional atende e os horários criam-se sozinhos."
            action={newButton}
          />
        )}
        <p className="text-sm text-muted">
          Desativar uma regra remove os horários livres que ela criou; as marcações já feitas mantêm-se.
        </p>
      </section>

      <TimeOffSection professionals={professionals} onChanged={reload} />

      {creating && (
        <RuleForm
          professionals={activeProfessionals}
          services={activeServices}
          onClose={() => setCreating(false)}
          onCreated={(generation) => {
            setCreating(false)
            setSummary({ title: 'Horários criados', generation })
            reload()
          }}
        />
      )}
      {summary && <GenerationModal title={summary.title} generation={summary.generation} onClose={() => setSummary(null)} />}
    </div>
  )
}
