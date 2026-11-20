import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wizard } from '@/components/app/Wizard'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { useWizardStep } from '@/hooks/useWizardStep'
import { useDraft } from '@/lib/draft'
import { canNavigateBack } from '@/lib/navigation'
import { MAX_NOTE_LENGTH, luandaIso, timeOffErrorMessage } from '@/lib/schedule'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

const TITLES = ['Quando começa a pausa?', 'Quando acaba?', 'Quer deixar uma nota?'] as const

interface Draft {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  note: string
}

/** Pausa ou férias (UC-MKT-09): os horários livres desse intervalo são retirados. Horas de Luanda. */
function TimeOffWizard() {
  const toast = useToast()
  const navigate = useNavigate()
  const exit = () => (canNavigateBack() ? navigate(-1) : navigate(paths.professionalSchedule, { replace: true }))
  const { step, next, back, last } = useWizardStep(TITLES.length, exit)
  const [draft, update, clearDraft] = useDraft<Draft>('time-off', { startDate: '', startTime: '08:00', endDate: '', endTime: '18:00', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const change = (patch: Partial<Draft>) => {
    setError(null)
    update(patch)
  }

  function problem(): string | null {
    if (step === 0 && (!draft.startDate || !draft.startTime)) return 'Indique o dia e a hora de início.'
    if (step === 1) {
      if (!draft.endDate || !draft.endTime) return 'Indique o dia e a hora de fim.'
      const start = Date.parse(luandaIso(draft.startDate, draft.startTime))
      const end = Date.parse(luandaIso(draft.endDate, draft.endTime))
      if (end <= start) return 'O fim tem de ser depois do início.'
      if (end <= Date.now()) return 'A pausa tem de acabar no futuro.'
    }
    if (step === 2 && draft.note.trim().length > MAX_NOTE_LENGTH) return `A nota pode ter até ${MAX_NOTE_LENGTH} letras.`
    return null
  }

  async function save() {
    setSaving(true)
    try {
      await professionalPortalService.createTimeOff({ startsAt: luandaIso(draft.startDate, draft.startTime), endsAt: luandaIso(draft.endDate, draft.endTime), reason: draft.note.trim() || null })
      clearDraft()
      toast.show('Pausa guardada.')
      navigate(paths.professionalSchedule, { replace: true })
    } catch (failure) {
      setError(timeOffErrorMessage(failure))
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
    <Wizard
      title="Nova pausa"
      stepTitle={TITLES[step] ?? ''}
      description={step === 0 ? 'Horas de Luanda. Os horários livres deste período são retirados.' : step === 2 ? 'Opcional. É só para si.' : undefined}
      step={step}
      total={TITLES.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar pausa' : 'Continuar'}
      busy={saving}
      error={error}
    >
      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Input label="Dia de início" type="date" value={draft.startDate} onChange={(event) => change({ startDate: event.target.value, endDate: draft.endDate || event.target.value })} />
          <Input label="Hora de início" type="time" value={draft.startTime} onChange={(event) => change({ startTime: event.target.value })} />
        </div>
      )}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Input label="Dia de fim" type="date" value={draft.endDate} onChange={(event) => change({ endDate: event.target.value })} />
          <Input label="Hora de fim" type="time" value={draft.endTime} onChange={(event) => change({ endTime: event.target.value })} />
        </div>
      )}
      {step === 2 && <Textarea label="Nota (opcional)" rows={3} maxLength={MAX_NOTE_LENGTH} value={draft.note} onChange={(event) => change({ note: event.target.value })} hint={`Até ${MAX_NOTE_LENGTH} letras.`} />}
    </Wizard>
  )
}

export function ProfessionalTimeOffNewPage() {
  usePageTitle('Nova pausa')
  const { state, reload, profile, rights } = useProfessionalProfile()
  if (state.status === 'error') return <ErrorState onRetry={reload} />
  if (!profile || !rights) return <LoadingState rows={2} />
  if (!rights.commercial)
    return (
      <div className="flex flex-col gap-4 pt-6">
        <LockedNotice>Neste estado não é possível adicionar pausas.</LockedNotice>
        <ButtonLink to={paths.professionalSchedule} size="xl" fullWidth>
          Voltar aos horários
        </ButtonLink>
      </div>
    )
  return <TimeOffWizard />
}
