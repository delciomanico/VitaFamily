import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChoiceChecks, ChoiceList } from '@/components/app/ChoiceList'
import { SheetNotice, SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { useWizardStep } from '@/hooks/useWizardStep'
import { useDraft } from '@/lib/draft'
import { useModalRoute } from '@/lib/modalRoute'
import { WEEKDAYS, offerMethodLabel, weekdayLabel } from '@/lib/professional'
import { generationMessage, minutesOf, ruleErrorMessage, sortedDays } from '@/lib/schedule'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { ProfessionalOffer, ProfessionalScheduleRule, Specialty, Weekday } from '@/types/professional'

interface Draft {
  offerId: string
  weekdays: string[]
  startTime: string
  endTime: string
  validFrom: string
  validUntil: string
}

interface WizardProps {
  rule?: ProfessionalScheduleRule
  offers: ProfessionalOffer[]
  specialties: Specialty[]
  approved: boolean
}

/** Novo horário semanal (ou edição) passo a passo (UC-MKT-09, BR-MKT-25): serviço, dias, horas e validade. */
function RuleWizard({ rule, offers, specialties, approved }: WizardProps) {
  const toast = useToast()
  const editing = rule !== undefined
  // Ao editar, o serviço fica fixo: o primeiro passo desaparece.
  const titles = editing ? ['Em que dias atende?', 'A que horas?', 'Até quando vale?'] : ['Para que serviço?', 'Em que dias atende?', 'A que horas?', 'Até quando vale?']
  const { close, saved } = useModalRoute(paths.professionalSchedule)
  const { step: raw, next, back, last } = useWizardStep(titles.length, close)
  const step = editing ? raw + 1 : raw // 0 serviço, 1 dias, 2 horas, 3 validade
  const initialDraft: Draft = {
    offerId: rule?.offerId ?? '',
    weekdays: (rule ? sortedDays(rule.weekdays) : []).map(String),
    startTime: rule?.startTime ?? '',
    endTime: rule?.endTime ?? '',
    validFrom: rule?.validFrom ?? '',
    validUntil: rule?.validUntil ?? '',
  }
  const [draft, update, clearDraft] = useDraft<Draft>(rule ? `rule-${rule.id}` : 'rule', initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const change = (patch: Partial<Draft>) => {
    setError(null)
    update(patch)
  }

  const specialtyName = (id: string) => specialties.find((s) => s.id === id)?.name ?? 'Serviço'
  const offer = offers.find((o) => o.id === draft.offerId)

  function problem(): string | null {
    if (step === 0 && !draft.offerId) return 'Escolha o serviço.'
    if (step === 1 && draft.weekdays.length === 0) return 'Escolha pelo menos um dia da semana.'
    if (step === 2) {
      if (!draft.startTime) return 'Indique a hora a que começa.'
      if (!draft.endTime) return 'Indique a hora a que acaba.'
      const span = minutesOf(draft.endTime) - minutesOf(draft.startTime)
      if (span <= 0) return 'A hora de fim tem de ser depois da hora de início.'
      if (offer && span < offer.durationMinutes) return `Precisa de pelo menos ${offer.durationMinutes} minutos entre o início e o fim, a duração do serviço.`
    }
    if (step === 3 && draft.validFrom && draft.validUntil && draft.validUntil < draft.validFrom) return 'A data de fim tem de ser igual ou depois da data de início.'
    return null
  }

  async function save() {
    setSaving(true)
    const common = {
      weekdays: sortedDays(draft.weekdays.map(Number) as Weekday[]),
      startTime: draft.startTime,
      endTime: draft.endTime,
      validFrom: draft.validFrom || null,
      validUntil: draft.validUntil || null,
    }
    try {
      const result = rule ? await professionalPortalService.updateScheduleRule(rule.id, common) : await professionalPortalService.createScheduleRule({ offerId: draft.offerId, ...common })
      clearDraft()
      toast.show(generationMessage(result.generation, approved))
      saved()
    } catch (failure) {
      setError(ruleErrorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function onNext() {
    const found = problem()
    if (found) return setError(found)
    setError(null)
    if (!last) return next()
    void save()
  }

  return (
    <WizardSheet
      onClose={close}
      onDiscard={clearDraft}
      dirty={JSON.stringify(draft) !== JSON.stringify(initialDraft)}
      title={editing ? 'Mudar horário' : 'Novo horário'}
      stepTitle={titles[raw] ?? ''}
      description={step === 2 ? 'Horas de Luanda.' : step === 3 ? 'Opcional. Se não escolher, o horário vale para sempre.' : undefined}
      step={raw}
      total={titles.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar horário' : 'Continuar'}
      busy={saving}
      error={error}
    >
      {step === 0 && (
        <ChoiceList
          legend="Serviço"
          hideLegend
          options={offers.map((o) => ({ value: o.id, label: specialtyName(o.specialtyId), hint: `${offerMethodLabel[o.method]} · ${o.durationMinutes} min` }))}
          value={draft.offerId}
          onChange={(offerId) => change({ offerId })}
        />
      )}
      {step === 1 && <ChoiceChecks legend="Dias da semana" hideLegend columns={2} options={WEEKDAYS.map((day) => ({ value: String(day), label: weekdayLabel[day] }))} value={draft.weekdays} onChange={(weekdays) => change({ weekdays })} />}
      {step === 2 && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Começa às" type="time" value={draft.startTime} onChange={(event) => change({ startTime: event.target.value })} />
          <Input label="Acaba às" type="time" value={draft.endTime} onChange={(event) => change({ endTime: event.target.value })} />
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <Input label="Vale a partir de" type="date" value={draft.validFrom} onChange={(event) => change({ validFrom: event.target.value })} hint="Opcional" />
          <Input label="Vale até" type="date" value={draft.validUntil} onChange={(event) => change({ validUntil: event.target.value })} hint="Opcional" />
        </div>
      )}
    </WizardSheet>
  )
}

/** Entrada: carrega serviços ativos, especialidades e (ao editar) a regra; só com permissão comercial. */
export function ProfessionalScheduleRulePage() {
  const { ruleId } = useParams()
  usePageTitle(ruleId ? 'Mudar horário' : 'Novo horário')
  const profile = useProfessionalProfile()
  const offers = useAsync(() => professionalPortalService.listOffers(true), [])
  const rules = useAsync(() => (ruleId ? professionalPortalService.listScheduleRules() : Promise.resolve([])), [ruleId])

  const { close } = useModalRoute(paths.professionalSchedule)
  const failed = profile.state.status === 'error' || offers.state.status === 'error' || rules.state.status === 'error'
  if (failed || !profile.profile || !profile.rights || offers.state.status !== 'success' || rules.state.status !== 'success')
    return (
      <SheetWait
        title={ruleId ? 'Mudar horário' : 'Novo horário'}
        onClose={close}
        failed={failed}
        onRetry={() => {
          profile.reload()
          offers.reload()
          rules.reload()
        }}
      />
    )

  const rule = ruleId ? rules.state.data.find((r) => r.id === ruleId) : undefined
  const blocked = !profile.rights.commercial
  const noOffers = offers.state.data.length === 0
  if (blocked || noOffers || (ruleId && !rule))
    return (
      <SheetNotice
        title={blocked ? 'Horários' : ruleId ? 'Horário não encontrado' : 'Primeiro, um serviço'}
        onClose={close}
        closeLabel="Voltar aos horários"
        actions={
          noOffers && !blocked && !ruleId ? (
            <ButtonLink to={paths.professionalOfferNew} replace size="xl" fullWidth>
              Criar um serviço
            </ButtonLink>
          ) : undefined
        }
      >
        {blocked ? (
          <LockedNotice>Neste estado não é possível criar nem mudar horários.</LockedNotice>
        ) : (
          <p role="note" className="text-base text-muted">
            {ruleId ? 'Volte à lista de horários.' : 'Para definir horários precisa de pelo menos um serviço ativo.'}
          </p>
        )}
      </SheetNotice>
    )
  return <RuleWizard rule={rule} offers={offers.state.data} specialties={profile.profile.specialties} approved={profile.profile.validationStatus === 'APPROVED'} />
}
