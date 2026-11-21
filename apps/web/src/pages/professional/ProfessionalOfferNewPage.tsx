import { useState } from 'react'
import { ChoiceList } from '@/components/app/ChoiceList'
import { SheetNotice, SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { useWizardStep } from '@/hooks/useWizardStep'
import { useDraft } from '@/lib/draft'
import { useModalRoute } from '@/lib/modalRoute'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { offerErrorMessage, parsePrice, MAX_NOTE_LENGTH } from '@/lib/offers'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import { MAX_PRICE_KZ, OFFER_DURATIONS, type OfferMethod, type Specialty } from '@/types/professional'

const STEPS = ['O que oferece?', 'Como atende?', 'Quanto tempo dura?', 'Quanto custa?', 'Quer deixar uma nota?'] as const
const METHODS = Object.keys(offerMethodLabel) as OfferMethod[]
const METHOD_HINT: Record<OfferMethod, string> = {
  IN_PERSON: 'A família vai ao seu espaço',
  VIDEO: 'Por videochamada',
  CHAT: 'Por mensagens',
  PHONE: 'Por chamada de telefone',
}

interface Draft {
  specialtyId: string
  method: OfferMethod | ''
  duration: string
  price: string
  note: string
}

/** Criar um serviço (oferta) passo a passo (UC-MKT-08, BR-MKT-24/31): especialidade, método, duração, preço e nota. */
function OfferWizard({ specialties }: { specialties: Specialty[] }) {
  const toast = useToast()
  const { close, saved } = useModalRoute(paths.professionalOffers)
  const { step, next, back, last } = useWizardStep(STEPS.length, close)
  const [draft, update, clearDraft] = useDraft<Draft>('offer', { specialtyId: specialties.length === 1 ? (specialties[0]?.id ?? '') : '', method: '', duration: '', price: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const change = (patch: Partial<Draft>) => {
    setError(null)
    update(patch)
  }

  async function save() {
    const durationValue = OFFER_DURATIONS.find((d) => String(d) === draft.duration)
    const price = parsePrice(draft.price)
    if (!draft.method || !durationValue || price === null) return
    setSaving(true)
    try {
      await professionalPortalService.createOffer({ specialtyId: draft.specialtyId, method: draft.method, durationMinutes: durationValue, priceKz: price, note: draft.note.trim() || null })
      clearDraft()
      toast.show('Serviço criado.')
      saved()
    } catch (failure) {
      setError(offerErrorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function onNext() {
    if (step === 0 && !draft.specialtyId) return setError('Escolha a especialidade.')
    if (step === 1 && !draft.method) return setError('Escolha como atende.')
    if (step === 2 && !draft.duration) return setError('Escolha a duração.')
    if (step === 3 && parsePrice(draft.price) === null) return setError(`Escreva o preço em Kwanza, só com números, até ${formatKz(MAX_PRICE_KZ)}. Para gratuito, escreva 0.`)
    if (step === 4 && draft.note.length > MAX_NOTE_LENGTH) return setError(`Use no máximo ${MAX_NOTE_LENGTH} letras.`)
    setError(null)
    if (!last) return next()
    void save()
  }

  const specialtyName = specialties.find((s) => s.id === draft.specialtyId)?.name

  return (
    <WizardSheet
      onClose={close}
      onDiscard={clearDraft}
      dirty={Boolean(draft.method || draft.duration || draft.price || draft.note)}
      title="Novo serviço"
      stepTitle={STEPS[step] ?? ''}
      description={step === 3 ? 'Em Kwanza. Escreva 0 se for gratuito.' : step === 4 ? 'Opcional. Por exemplo, a morada do atendimento.' : undefined}
      step={step}
      total={STEPS.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar serviço' : 'Continuar'}
      busy={saving}
      error={error}
    >
      {step === 0 && <ChoiceList legend="Especialidade" hideLegend options={specialties.map((s) => ({ value: s.id, label: s.name }))} value={draft.specialtyId} onChange={(specialtyId) => change({ specialtyId })} />}
      {step === 1 && <ChoiceList legend="Método" hideLegend options={METHODS.map((m) => ({ value: m, label: offerMethodLabel[m], hint: METHOD_HINT[m] }))} value={draft.method} onChange={(method) => change({ method })} />}
      {step === 2 && <ChoiceList legend="Duração" hideLegend columns={2} options={OFFER_DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))} value={draft.duration} onChange={(duration) => change({ duration })} />}
      {step === 3 && (
        <Input label="Preço (Kz)" type="number" inputMode="numeric" step={1} min={0} max={MAX_PRICE_KZ} value={draft.price} onChange={(event) => change({ price: event.target.value })} />
      )}
      {step === 4 && (
        <>
          <Textarea label="Nota (opcional)" rows={3} maxLength={MAX_NOTE_LENGTH} value={draft.note} onChange={(event) => change({ note: event.target.value })} hint={`Até ${MAX_NOTE_LENGTH} letras.`} />
          <section aria-label="Resumo do serviço" className="flex flex-col gap-1 rounded-2xl bg-surface-muted p-4 text-base">
            <p className="font-semibold">{specialtyName}</p>
            <p>
              {draft.method && offerMethodLabel[draft.method]} · {draft.duration} min
            </p>
            <p className="text-lg font-semibold">{parsePrice(draft.price) !== null ? formatKz(parsePrice(draft.price) ?? 0) : ''}</p>
          </section>
        </>
      )}
    </WizardSheet>
  )
}

/** Entrada do assistente: precisa de pelo menos uma especialidade e de permissão para alterar ofertas. */
export function ProfessionalOfferNewPage() {
  usePageTitle('Novo serviço')
  const { state, reload, profile, rights } = useProfessionalProfile()
  const { close } = useModalRoute(paths.professionalOffers)
  if (state.status === 'error' || !profile || !rights) return <SheetWait title="Novo serviço" onClose={close} onRetry={reload} failed={state.status === 'error'} />
  if (!rights.commercial)
    return (
      <SheetNotice title="Novo serviço" onClose={close} closeLabel="Voltar aos serviços">
        <LockedNotice>Neste estado não é possível criar serviços.</LockedNotice>
      </SheetNotice>
    )
  if (profile.specialties.length === 0)
    return (
      <SheetNotice
        title="Primeiro, a sua especialidade"
        onClose={close}
        actions={
          <ButtonLink to={paths.professionalProfileEdit} replace size="xl" fullWidth>
            Escolher a especialidade
          </ButtonLink>
        }
      >
        <p role="note" className="text-base text-muted">
          Ainda não escolheu nenhuma especialidade. Precisamos dela para criar o serviço.
        </p>
      </SheetNotice>
    )
  return <OfferWizard specialties={profile.specialties} />
}
