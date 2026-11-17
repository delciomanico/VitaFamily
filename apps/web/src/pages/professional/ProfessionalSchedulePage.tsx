import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarOff, Clock, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { WEEKDAYS, offerMethodLabel, weekdayLabel } from '@/lib/professional'
import { formatLongDate, formatShortDate, formatTimeLuanda, formatWhenLuanda, luandaDayISO } from '@/lib/format'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type {
  ProfessionalOffer,
  ProfessionalScheduleGeneration,
  ProfessionalScheduleRule,
  ProfessionalScheduleRuleResult,
  ProfessionalSlot,
  ProfessionalTimeOff,
  Specialty,
  Weekday,
} from '@/types/professional'

/**
 * Horários do profissional (UC-MKT-09, BR-MKT-25): regras semanais por oferta, bloqueios/férias e horários gerados.
 * Todas as horas são de Luanda (Africa/Luanda, UTC+1, sem horário de verão). As regras só geram horários com o
 * perfil APPROVED; noutros estados ficam guardadas.
 */

const MAX_NOTE_LENGTH = 200
const MAX_RANGE_DAYS = 62
const DEFAULT_RANGE_DAYS = 14
const DAY_MS = 86_400_000

/** Instante ISO de uma data e hora locais de Luanda. */
const luandaIso = (date: string, time: string) => `${date}T${time}:00+01:00`

/** Minutos desde a meia-noite de um HH:mm. */
function minutesOf(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

/** Soma dias a uma data ISO (yyyy-mm-dd) sem depender do fuso. */
function addDays(iso: string, days: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  return todayISO(new Date(year, month - 1, day + days))
}

function daysBetween(from: string, to: string): number {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number)
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/** Validação do intervalo de horários gerados (máx. 62 dias, como a API). */
function validateRange(from: string, to: string): string | null {
  if (!isValidISODate(from) || !isValidISODate(to)) return 'Indique as duas datas do intervalo.'
  if (to < from) return 'A data «até» tem de ser igual ou posterior à data «de».'
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return `O intervalo pode ter no máximo ${MAX_RANGE_DAYS} dias.`
  return null
}

const sortedDays = (days: Weekday[]) => [...days].sort((a, b) => a - b)

function validityText(rule: ProfessionalScheduleRule): string {
  if (!rule.validFrom && !rule.validUntil) return 'Sem limite de validade'
  const parts: string[] = []
  if (rule.validFrom) parts.push(`de ${formatShortDate(rule.validFrom)}`)
  if (rule.validUntil) parts.push(`até ${formatShortDate(rule.validUntil)}`)
  return `Válida ${parts.join(' ')}`
}

/** Mensagem de sobreposição (CONFLICT) específica; o resto vem de `errorMessage`. */
function ruleErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Esta regra sobrepõe-se a outra regra ativa. Ajuste as horas ou desative a outra regra.'
  return errorMessage(error)
}

function timeOffErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Este intervalo sobrepõe-se a outro bloqueio.'
  return errorMessage(error)
}

/** Resumo da geração: sem perfil aprovado, as regras ficam guardadas e os horários só nascem depois. */
function generationMessage(generation: ProfessionalScheduleGeneration, approved: boolean): string {
  if (!approved) return 'As regras ficam guardadas e os horários nascem quando o perfil for aprovado.'
  const skipped = generation.skippedOverlap + generation.skippedTimeOff
  const created = generation.created === 1 ? 'Criado 1 horário' : `Criados ${generation.created} horários`
  return `${created}; ${skipped} ignorados por sobreposição/bloqueio.`
}

/* ───────────────────────── Regras ───────────────────────── */

interface RulesSectionProps {
  canEdit: boolean
  approved: boolean
  specialties: Specialty[]
  onChanged: () => void
}

type FormMode = 'create' | ProfessionalScheduleRule | null

function RulesSection({ canEdit, approved, specialties, onChanged }: RulesSectionProps) {
  const toast = useToast()
  const offers = useAsync(() => professionalPortalService.listOffers(true), [])
  const rules = useAsync(() => professionalPortalService.listScheduleRules(), [])
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const specialtyName = (id: string) => specialties.find((s) => s.id === id)?.name ?? 'Especialidade'
  const activeOffers = offers.state.status === 'success' ? offers.state.data : []
  const offerById = new Map(activeOffers.map((o) => [o.id, o]))

  // Oferta desativada não aparece na lista de ativas: a regra mostra-o em vez de falhar.
  const offerLabel = (offerId: string) => {
    const offer = offerById.get(offerId)
    if (!offer) return 'Oferta desativada'
    return `${specialtyName(offer.specialtyId)} · ${offerMethodLabel[offer.method]} · ${offer.durationMinutes} min`
  }
  const durationOf = (offerId: string) => offerById.get(offerId)?.durationMinutes

  function reloadAll() {
    offers.reload()
    rules.reload()
  }

  function onSaved(result: ProfessionalScheduleRuleResult) {
    setFormMode(null)
    toast.show(generationMessage(result.generation, approved))
    rules.reload()
    onChanged()
  }

  async function toggle(rule: ProfessionalScheduleRule) {
    setBusyId(rule.id)
    try {
      const result = await professionalPortalService.updateScheduleRule(rule.id, { active: !rule.active })
      toast.show(rule.active ? 'Regra desativada.' : generationMessage(result.generation, approved))
      rules.reload()
      onChanged()
    } catch (error) {
      toast.show(ruleErrorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const loading = offers.state.status === 'loading' || rules.state.status === 'loading'
  const loadError = offers.state.status === 'error' || rules.state.status === 'error'
  const list = rules.state.status === 'success' ? rules.state.data : []

  return (
    <section aria-labelledby="horarios-regras" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="horarios-regras" className="text-base font-semibold">
            Regras
          </h2>
          <p className="text-sm text-muted">
            Dias e horas semanais por oferta, em Luanda. Ao guardar, os horários são gerados para as próximas 8 semanas.
            {!approved && ' Enquanto o perfil não estiver aprovado, as regras ficam guardadas e os horários só nascem depois da aprovação.'}
          </p>
        </div>
        {canEdit && !loading && !loadError && activeOffers.length > 0 && (
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setFormMode('create')}>
            Nova regra
          </Button>
        )}
      </div>

      {loading && <LoadingState rows={2} />}
      {!loading && loadError && <ErrorState onRetry={reloadAll} />}

      {!loading && !loadError && activeOffers.length === 0 && (
        <p className="text-sm text-muted">
          Para definir horários precisa de pelo menos uma oferta ativa.{' '}
          <Link to={paths.professionalOffers} className="font-medium text-primary underline">
            Ir para Serviços e preços
          </Link>
        </p>
      )}

      {!loading &&
        !loadError &&
        (list.length === 0 ? (
          <EmptyState icon={Clock} title="Ainda não tem regras de horário" description="Crie uma regra por oferta, com os dias e as horas em que atende." />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((rule) => {
              const busy = busyId === rule.id
              return (
                <li key={rule.id}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="font-medium">{offerLabel(rule.offerId)}</p>
                        <p className="text-sm text-muted">{sortedDays(rule.weekdays).map((d) => weekdayLabel[d]).join(', ')}</p>
                      </div>
                      <Badge tone={rule.active ? 'success' : 'neutral'} dot>
                        {rule.active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </div>
                    <p className="text-sm">
                      {rule.startTime}–{rule.endTime} · {validityText(rule)}
                    </p>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Pencil className="size-4" aria-hidden />}
                          onClick={() => setFormMode(rule)}
                          disabled={busy}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={rule.active ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />}
                          loading={busy}
                          onClick={() => toggle(rule)}
                        >
                          {rule.active ? 'Desativar' : 'Ativar'}
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        ))}

      {formMode && (
        <ScheduleRuleForm
          rule={formMode === 'create' ? undefined : formMode}
          offers={activeOffers}
          offerLabel={offerLabel}
          durationOf={durationOf}
          onClose={() => setFormMode(null)}
          onSaved={onSaved}
        />
      )}
    </section>
  )
}

type RuleFieldErrors = Partial<Record<'offer' | 'weekdays' | 'startTime' | 'endTime' | 'validUntil', string>>

interface ScheduleRuleFormProps {
  /** Ausente = criar; presente = editar (a oferta fica fixa). */
  rule?: ProfessionalScheduleRule
  offers: ProfessionalOffer[]
  offerLabel: (offerId: string) => string
  durationOf: (offerId: string) => number | undefined
  onClose: () => void
  onSaved: (result: ProfessionalScheduleRuleResult) => void
}

function ScheduleRuleForm({ rule, offers, offerLabel, durationOf, onClose, onSaved }: ScheduleRuleFormProps) {
  const editing = rule !== undefined
  const [offerId, setOfferId] = useState(rule?.offerId ?? '')
  const [weekdays, setWeekdays] = useState<Weekday[]>(rule ? sortedDays(rule.weekdays) : [])
  const [startTime, setStartTime] = useState(rule?.startTime ?? '')
  const [endTime, setEndTime] = useState(rule?.endTime ?? '')
  const [validFrom, setValidFrom] = useState(rule?.validFrom ?? '')
  const [validUntil, setValidUntil] = useState(rule?.validUntil ?? '')
  const [errors, setErrors] = useState<RuleFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const offerOptions = editing
    ? [{ value: rule.offerId, label: offerLabel(rule.offerId) }]
    : offers.map((offer) => ({ value: offer.id, label: offerLabel(offer.id) }))

  function toggleDay(day: Weekday, checked: boolean) {
    setWeekdays((current) => (checked ? sortedDays([...current, day]) : current.filter((d) => d !== day)))
    setErrors((current) => ({ ...current, weekdays: undefined }))
  }

  function validate(): RuleFieldErrors {
    const found: RuleFieldErrors = {}
    if (!offerId) found.offer = 'Escolha a oferta.'
    if (weekdays.length === 0) found.weekdays = 'Escolha pelo menos um dia da semana.'
    if (!startTime) found.startTime = 'Indique a hora de início.'
    if (!endTime) found.endTime = 'Indique a hora de fim.'
    if (startTime && endTime) {
      const span = minutesOf(endTime) - minutesOf(startTime)
      const duration = durationOf(offerId)
      if (span <= 0) found.endTime = 'A hora de fim tem de ser posterior à hora de início.'
      else if (duration !== undefined && span < duration) {
        found.endTime = `O intervalo tem de ter pelo menos ${duration} minutos, a duração da oferta.`
      }
    }
    if (validFrom && validUntil && validUntil < validFrom) {
      found.validUntil = 'A validade até tem de ser igual ou posterior a «válido de».'
    }
    return found
  }

  async function save() {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    setFormError(null)
    const common = {
      weekdays,
      startTime,
      endTime,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
    }
    try {
      const result = rule
        ? await professionalPortalService.updateScheduleRule(rule.id, common)
        : await professionalPortalService.createScheduleRule({ offerId, ...common })
      onSaved(result)
    } catch (error) {
      setFormError(ruleErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar regra de horário' : 'Nova regra de horário'}
      description={editing ? 'A oferta não pode ser alterada. Para outra oferta, crie uma nova regra.' : 'As horas são de Luanda (UTC+1).'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Oferta"
          options={offerOptions}
          placeholder={editing ? undefined : 'Escolha a oferta'}
          value={offerId}
          disabled={editing}
          error={errors.offer}
          onChange={(event) => {
            setOfferId(event.target.value)
            setErrors((current) => ({ ...current, offer: undefined }))
          }}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Dias da semana</legend>
          <div className="grid grid-cols-2 gap-3">
            {WEEKDAYS.map((day) => (
              <Checkbox
                key={day}
                label={weekdayLabel[day]}
                checked={weekdays.includes(day)}
                onChange={(event) => toggleDay(day, event.target.checked)}
              />
            ))}
          </div>
          {errors.weekdays && (
            <p role="alert" className="text-sm text-danger">
              {errors.weekdays}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Hora de início"
            type="time"
            value={startTime}
            error={errors.startTime}
            onChange={(event) => {
              setStartTime(event.target.value)
              setErrors((current) => ({ ...current, startTime: undefined, endTime: undefined }))
            }}
          />
          <Input
            label="Hora de fim"
            type="time"
            value={endTime}
            error={errors.endTime}
            onChange={(event) => {
              setEndTime(event.target.value)
              setErrors((current) => ({ ...current, endTime: undefined }))
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Válida de" type="date" hint="Opcional" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
          <Input
            label="Válida até"
            type="date"
            hint="Opcional"
            value={validUntil}
            error={errors.validUntil}
            onChange={(event) => {
              setValidUntil(event.target.value)
              setErrors((current) => ({ ...current, validUntil: undefined }))
            }}
          />
        </div>

        <FormError message={formError} />
      </div>
    </Modal>
  )
}

/* ───────────────────────── Bloqueios e férias ───────────────────────── */

interface TimeOffDraft {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  note: string
}

const EMPTY_DRAFT: TimeOffDraft = { startDate: '', startTime: '', endDate: '', endTime: '', note: '' }

function validateTimeOff(draft: TimeOffDraft): string | null {
  if (!draft.startDate || !draft.startTime) return 'Indique a data e a hora de início.'
  if (!draft.endDate || !draft.endTime) return 'Indique a data e a hora de fim.'
  const start = Date.parse(luandaIso(draft.startDate, draft.startTime))
  const end = Date.parse(luandaIso(draft.endDate, draft.endTime))
  if (end <= start) return 'O fim tem de ser posterior ao início.'
  if (end <= Date.now()) return 'O bloqueio tem de terminar no futuro.'
  if (draft.note.trim().length > MAX_NOTE_LENGTH) return `A nota pode ter até ${MAX_NOTE_LENGTH} caracteres.`
  return null
}

interface TimeOffSectionProps {
  canEdit: boolean
  onChanged: () => void
}

function TimeOffSection({ canEdit, onChanged }: TimeOffSectionProps) {
  const toast = useToast()
  const timeOff = useAsync(() => professionalPortalService.listTimeOff(), [])
  const [draft, setDraft] = useState<TimeOffDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toRemove, setToRemove] = useState<ProfessionalTimeOff | null>(null)
  const [removing, setRemoving] = useState(false)

  function update<K extends keyof TimeOffDraft>(key: K, value: TimeOffDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validateTimeOff(draft)
    if (problem) {
      setFormError(problem)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await professionalPortalService.createTimeOff({
        startsAt: luandaIso(draft.startDate, draft.startTime),
        endsAt: luandaIso(draft.endDate, draft.endTime),
        reason: draft.note.trim() || null,
      })
      toast.show('Bloqueio adicionado.')
      setDraft(EMPTY_DRAFT)
      timeOff.reload()
      onChanged()
    } catch (error) {
      setFormError(timeOffErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeTimeOff() {
    if (!toRemove) return
    setRemoving(true)
    try {
      await professionalPortalService.deleteTimeOff(toRemove.id)
      toast.show('Bloqueio removido.')
      setToRemove(null)
      timeOff.reload()
      onChanged()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setRemoving(false)
    }
  }

  const loading = timeOff.state.status === 'loading'
  const list = timeOff.state.status === 'success' ? timeOff.state.data : []

  return (
    <section aria-labelledby="horarios-bloqueios" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="horarios-bloqueios" className="text-base font-semibold">
          Bloqueios e férias
        </h2>
        <p className="text-sm text-muted">Períodos em que não atende. Os horários livres desse intervalo são retirados. Horas de Luanda (UTC+1).</p>
      </div>

      {loading && <LoadingState rows={1} />}
      {!loading && timeOff.state.status === 'error' && <ErrorState onRetry={timeOff.reload} />}

      {!loading && timeOff.state.status === 'success' &&
        (list.length === 0 ? (
          <EmptyState icon={CalendarOff} title="Sem bloqueios" description="Quando estiver de férias ou indisponível, adicione o período aqui." />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((item) => (
              <li key={item.id}>
                <Card className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-medium">
                      {formatWhenLuanda(item.startsAt)} – {formatWhenLuanda(item.endsAt)}
                    </p>
                    {item.reason && <p className="text-sm break-words text-muted">{item.reason}</p>}
                  </div>
                  {canEdit && (
                    <Button variant="danger-ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setToRemove(item)}>
                      Remover
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {canEdit && (
        <Card>
          <form onSubmit={save} className="flex flex-col gap-4" noValidate>
            <h3 className="font-medium">Novo bloqueio</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Início: data" type="date" value={draft.startDate} onChange={(e) => update('startDate', e.target.value)} />
              <Input label="Início: hora" type="time" value={draft.startTime} onChange={(e) => update('startTime', e.target.value)} />
              <Input label="Fim: data" type="date" value={draft.endDate} onChange={(e) => update('endDate', e.target.value)} />
              <Input label="Fim: hora" type="time" value={draft.endTime} onChange={(e) => update('endTime', e.target.value)} />
            </div>
            <Textarea
              label="Nota (opcional)"
              hint={`Nota interna, só para si. Até ${MAX_NOTE_LENGTH} caracteres.`}
              maxLength={MAX_NOTE_LENGTH}
              rows={2}
              value={draft.note}
              onChange={(e) => update('note', e.target.value)}
            />
            <FormError message={formError} />
            <div>
              <Button type="submit" loading={saving}>
                Adicionar bloqueio
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={toRemove !== null}
        title="Remover bloqueio?"
        description="Os horários deste intervalo poderão voltar a ser gerados, se houver regras ativas."
        confirmLabel="Remover"
        destructive
        loading={removing}
        onConfirm={removeTimeOff}
        onCancel={() => setToRemove(null)}
      />
    </section>
  )
}

/* ───────────────────────── Horários gerados ───────────────────────── */

/** Agrupa por dia (dia em Luanda) e ordena cronologicamente. */
function groupSlotsByDay(slots: ProfessionalSlot[]): Array<[string, ProfessionalSlot[]]> {
  const byDay = new Map<string, ProfessionalSlot[]>()
  const ordered = [...slots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  for (const slot of ordered) {
    const day = luandaDayISO(slot.startsAt)
    byDay.set(day, [...(byDay.get(day) ?? []), slot])
  }
  return [...byDay.entries()]
}

function SlotsSection({ version }: { version: number }) {
  const [range, setRange] = useState(() => {
    const today = todayISO()
    return { from: today, to: addDays(today, DEFAULT_RANGE_DAYS) }
  })
  const rangeError = validateRange(range.from, range.to)

  // Intervalo inválido não chega à API: a mensagem fica visível e a lista é ocultada.
  const slots = useAsync((): Promise<ProfessionalSlot[]> => {
    if (validateRange(range.from, range.to)) return Promise.resolve([])
    return professionalPortalService.listSlots(luandaIso(range.from, '00:00'), luandaIso(addDays(range.to, 1), '00:00'))
  }, [range.from, range.to, version])

  const groups = slots.state.status === 'success' ? groupSlotsByDay(slots.state.data) : []

  return (
    <section aria-labelledby="horarios-gerados" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="horarios-gerados" className="text-base font-semibold">
          Horários gerados
        </h2>
        <p className="text-sm text-muted">
          Horários livres que os clientes podem marcar. Horas de Luanda (UTC+1). Só existem com o perfil aprovado.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="De" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <Input label="Até" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>
      <FormError message={rangeError} />

      {!rangeError && slots.state.status === 'loading' && <LoadingState rows={2} />}
      {!rangeError && slots.state.status === 'error' && <ErrorState onRetry={slots.reload} />}

      {!rangeError &&
        slots.state.status === 'success' &&
        (groups.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Sem horários neste intervalo"
            description="Os horários são gerados a partir das regras ativas, com o perfil aprovado."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([day, daySlots]) => (
              <div key={day} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium capitalize">{formatLongDate(day)}</h3>
                <ul className="flex flex-wrap gap-2">
                  {daySlots.map((slot) => (
                    <li key={slot.id}>
                      <Badge tone="primary">
                        {formatTimeLuanda(slot.startsAt)}–{formatTimeLuanda(slot.endsAt)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
    </section>
  )
}

/* ───────────────────────── Página ───────────────────────── */

export function ProfessionalSchedulePage() {
  usePageTitle('Horários')
  const profile = useProfessionalProfile()
  // Incrementa quando regras ou bloqueios mudam, para a lista de horários gerados se atualizar.
  const [slotsVersion, setSlotsVersion] = useState(0)
  const refreshSlots = () => setSlotsVersion((v) => v + 1)

  const canEdit = profile.rights?.commercial === true
  const approved = profile.profile?.validationStatus === 'APPROVED'
  const specialties = profile.profile?.specialties ?? []

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Horários</h1>
      <p className="text-sm text-muted">
        Defina os dias e as horas em que atende. Todas as horas são de Luanda (Africa/Luanda, UTC+1, sem horário de verão).
      </p>

      {profile.rights?.readOnly && (
        <LockedNotice>
          Neste estado o perfil está em modo só de leitura. Não é possível criar, alterar, ativar, desativar ou remover horários nem bloqueios.
        </LockedNotice>
      )}

      {profile.state.status === 'loading' && <LoadingState rows={3} />}
      {profile.state.status === 'error' && <ErrorState onRetry={profile.reload} />}

      {profile.profile && (
        <>
          <RulesSection canEdit={canEdit} approved={approved} specialties={specialties} onChanged={refreshSlots} />
          <TimeOffSection canEdit={canEdit} onChanged={refreshSlots} />
          <SlotsSection version={slotsVersion} />
        </>
      )}
    </div>
  )
}
