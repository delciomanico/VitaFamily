import { useState } from 'react'
import { ChoiceChecks } from '@/components/app/ChoiceList'
import { SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { useWizardStep } from '@/hooks/useWizardStep'
import { useDraft } from '@/lib/draft'
import { errorMessage } from '@/lib/errors'
import { useModalRoute } from '@/lib/modalRoute'
import { categoryLabel, editRights } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { ProfessionalProfile, ProfessionalProfilePatch, Specialty } from '@/types/professional'

const LOCKED_IDENTITY_TEXT = 'Para alterar o nome ou as especialidades, peça ao administrador para reabrir.'
const STEPS = ['Como se chama?', 'Onde trabalha?', 'O que faz?', 'Fale um pouco de si', 'Como quer ser pago?'] as const

interface Draft {
  displayName: string
  city: string
  bio: string
  paymentInstructions: string
  specialtyIds: string[]
}

/** Valida um passo e devolve a mensagem humana do erro (ou `null`). */
function stepError(step: number, draft: Draft, identityOpen: boolean, textOpen: boolean): string | null {
  if (step === 0 && identityOpen) {
    const name = draft.displayName.trim()
    if (name.length < 2 || name.length > 120) return 'Escreva o seu nome, com 2 a 120 letras.'
  }
  if (step === 1 && textOpen) {
    const city = draft.city.trim()
    if (city.length < 2 || city.length > 80) return 'Escreva a cidade onde trabalha (2 a 80 letras).'
  }
  if (step === 2 && identityOpen) {
    if (draft.specialtyIds.length < 1) return 'Escolha pelo menos uma especialidade.'
    if (draft.specialtyIds.length > 5) return 'Pode escolher no máximo 5 especialidades.'
  }
  if (step === 3 && draft.bio.length > 1000) return 'Use no máximo 1000 letras.'
  if (step === 4 && draft.paymentInstructions.length > 500) return 'Use no máximo 500 letras.'
  return null
}

/** Dados do perfil passo a passo (UC-MKT-03): só os campos alterados são enviados em `PATCH /professional-portal/me`. */
function ProfileWizard({ profile, catalog }: { profile: ProfessionalProfile; catalog: Specialty[] }) {
  const toast = useToast()
  const rights = editRights(profile.validationStatus)
  const { close, saved } = useModalRoute(paths.professionalProfile)
  const { step, next, back, last } = useWizardStep(STEPS.length, close)
  const initialDraft: Draft = {
    displayName: profile.displayName ?? '',
    city: profile.city ?? '',
    bio: profile.bio ?? '',
    paymentInstructions: profile.paymentInstructions ?? '',
    specialtyIds: profile.specialties.map((specialty) => specialty.id),
  }
  const [draft, update, clearDraft] = useDraft<Draft>('profile', initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const change = (patch: Partial<Draft>) => {
    setError(null)
    update(patch)
  }

  async function save() {
    setSaving(true)
    try {
      const patch: ProfessionalProfilePatch = {}
      if (rights.identity && draft.displayName.trim() !== (profile.displayName ?? '')) patch.displayName = draft.displayName.trim()
      if (rights.profileText) {
        if (draft.city.trim() !== (profile.city ?? '')) patch.city = draft.city.trim()
        const bio = draft.bio.trim() || null
        if (bio !== (profile.bio ?? null)) patch.bio = bio
        const payment = draft.paymentInstructions.trim() || null
        if (payment !== (profile.paymentInstructions ?? null)) patch.paymentInstructions = payment
      }
      if (Object.keys(patch).length > 0) await professionalPortalService.updateMe(patch)
      const before = profile.specialties.map((specialty) => specialty.id).sort().join(',')
      if (rights.identity && [...draft.specialtyIds].sort().join(',') !== before) await professionalPortalService.setSpecialties(draft.specialtyIds)
      clearDraft()
      toast.show('Perfil guardado.')
      saved()
    } catch (failure) {
      // Ex.: CONFLICT ao retirar uma especialidade que tem serviços ativos.
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function onNext() {
    const problem = stepError(step, draft, rights.identity, rights.profileText)
    if (problem) return setError(problem)
    setError(null)
    if (!last) return next()
    if (rights.profileText || rights.identity) void save()
    else close()
  }

  return (
    <WizardSheet
      onClose={close}
      onDiscard={clearDraft}
      dirty={JSON.stringify(draft) !== JSON.stringify(initialDraft)}
      title="Os meus dados"
      stepTitle={STEPS[step] ?? ''}
      description={
        step === 0
          ? 'É o nome que as famílias vão ver.'
          : step === 2
            ? 'Escolha de 1 a 5 áreas.'
            : step === 3
              ? 'Opcional. Duas ou três frases chegam.'
              : step === 4
                ? 'Opcional. Só a família que marcar consigo vê isto; a equipa da Vita Family nunca vê.'
                : undefined
      }
      step={step}
      total={STEPS.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? (rights.profileText || rights.identity ? 'Guardar' : 'Fechar') : 'Continuar'}
      busy={saving}
      error={error}
    >
      {rights.readOnly && <LockedNotice>Perfil em modo só de leitura: pode ver os dados, mas não os pode alterar.</LockedNotice>}
      {step === 0 && (
        <>
          {!rights.identity && <LockedNotice>{LOCKED_IDENTITY_TEXT}</LockedNotice>}
          <Input label="Nome de apresentação" value={draft.displayName} disabled={!rights.identity} autoComplete="name" onChange={(event) => change({ displayName: event.target.value })} />
        </>
      )}
      {step === 1 && <Input label="Cidade" value={draft.city} disabled={!rights.profileText} autoComplete="address-level2" onChange={(event) => change({ city: event.target.value })} />}
      {step === 2 && (
        <>
          {!rights.identity && <LockedNotice>{LOCKED_IDENTITY_TEXT}</LockedNotice>}
          <ChoiceChecks
            legend="Especialidades"
            hideLegend
            disabled={!rights.identity}
            options={catalog.map((specialty) => ({ value: specialty.id, label: specialty.name, hint: categoryLabel[specialty.category] }))}
            value={draft.specialtyIds}
            onChange={(specialtyIds) => change({ specialtyIds })}
          />
        </>
      )}
      {step === 3 && <Textarea label="Biografia" rows={6} value={draft.bio} disabled={!rights.profileText} onChange={(event) => change({ bio: event.target.value })} hint={`${draft.bio.length}/1000`} />}
      {step === 4 && (
        <Textarea
          label="Instruções de pagamento"
          rows={5}
          value={draft.paymentInstructions}
          disabled={!rights.profileText}
          onChange={(event) => change({ paymentInstructions: event.target.value })}
          hint="Por exemplo: o IBAN para transferência."
        />
      )}
    </WizardSheet>
  )
}

/** Perfil do profissional (UC-MKT-03, `GET/PATCH /professional-portal/me`, `PUT …/specialties`). */
export function ProfessionalProfilePage() {
  usePageTitle('Os meus dados')
  const { state, reload, profile } = useProfessionalProfile()
  const catalog = useAsync(() => professionalPortalService.listSpecialtyCatalog(), [])

  const { close } = useModalRoute(paths.professionalProfile)
  const failed = state.status === 'error' || catalog.state.status === 'error'
  if (failed || !profile || catalog.state.status !== 'success')
    return <SheetWait title="Os meus dados" onClose={close} failed={failed} onRetry={state.status === 'error' ? reload : catalog.reload} />
  return <ProfileWizard profile={profile} catalog={catalog.state.data} />
}
