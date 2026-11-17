import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage } from '@/lib/errors'
import { categoryLabel, editRights } from '@/lib/professional'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { ProfessionalProfile, ProfessionalProfilePatch, Specialty } from '@/types/professional'

type Rights = ReturnType<typeof editRights>

const profileSchema = z.object({
  // Opcional: fica `undefined` quando o campo está bloqueado (campo disabled não entra nos valores).
  displayName: z.string().trim().min(2, 'Indique um nome com 2 a 120 caracteres.').max(120, 'Indique um nome com 2 a 120 caracteres.').optional(),
  city: z.string().trim().min(2, 'Indique a cidade (2 a 80 caracteres).').max(80, 'Indique a cidade (2 a 80 caracteres).').optional(),
  bio: z.string().max(1000, 'Use no máximo 1000 caracteres.'),
  paymentInstructions: z.string().max(500, 'Use no máximo 500 caracteres.'),
})
type ProfileFormValues = z.infer<typeof profileSchema>

const specialtySchema = z.object({
  specialtyIds: z
    .array(z.string())
    .min(1, 'Escolha pelo menos uma especialidade.')
    .max(5, 'Pode escolher no máximo 5 especialidades.'),
})
type SpecialtyFormValues = z.infer<typeof specialtySchema>

const LOCKED_IDENTITY_TEXT = 'Para alterar o nome ou as especialidades, peça ao administrador para reabrir.'

/** Dados do perfil (UC-MKT-03): só os campos alterados são enviados em `PATCH /professional-portal/me`. */
function ProfileForm({ profile, rights, onSaved }: { profile: ProfessionalProfile; rights: Rights; onSaved: () => void }) {
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: profile.displayName ?? '',
      city: profile.city ?? '',
      bio: profile.bio ?? '',
      paymentInstructions: profile.paymentInstructions ?? '',
    },
  })

  async function save(values: ProfileFormValues) {
    setFormError(null)
    const patch: ProfessionalProfilePatch = {}
    // Campos bloqueados chegam como `undefined`: não se enviam.
    if (rights.identity && values.displayName !== undefined && values.displayName !== profile.displayName) {
      patch.displayName = values.displayName
    }
    if (rights.profileText) {
      if (values.city !== undefined && values.city !== (profile.city ?? '')) patch.city = values.city
      // Vazio → null (apaga o campo opcional).
      const bio = values.bio.trim() || null
      if (bio !== (profile.bio ?? null)) patch.bio = bio
      const paymentInstructions = values.paymentInstructions.trim() || null
      if (paymentInstructions !== (profile.paymentInstructions ?? null)) patch.paymentInstructions = paymentInstructions
    }
    if (Object.keys(patch).length === 0) {
      toast.show('Não há alterações para guardar.')
      return
    }
    try {
      await professionalPortalService.updateMe(patch)
      toast.show('Perfil guardado.')
      onSaved()
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
      <Input
        label="Nome de apresentação"
        disabled={!rights.identity}
        autoComplete="name"
        error={errors.displayName?.message}
        {...register('displayName')}
      />
      <Input
        label="Cidade"
        disabled={!rights.profileText}
        autoComplete="address-level2"
        error={errors.city?.message}
        {...register('city')}
      />
      <Textarea
        label="Biografia"
        rows={4}
        disabled={!rights.profileText}
        error={errors.bio?.message}
        {...register('bio')}
      />
      <Textarea
        label="Instruções de pagamento"
        rows={3}
        disabled={!rights.profileText}
        hint="Só é mostrado depois de a família marcar; o administrador nunca o vê."
        error={errors.paymentInstructions?.message}
        {...register('paymentInstructions')}
      />
      <FormError message={formError} />
      {rights.profileText && (
        <div>
          <Button type="submit" loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      )}
    </form>
  )
}

/** Especialidades (UC-MKT-03): entre 1 e 5; bloqueadas fora de DRAFT/NEEDS_INFO. */
function SpecialtiesForm({
  profile,
  catalog,
  rights,
  onSaved,
}: {
  profile: ProfessionalProfile
  catalog: Specialty[]
  rights: Rights
  onSaved: () => void
}) {
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SpecialtyFormValues>({
    resolver: zodResolver(specialtySchema),
    defaultValues: { specialtyIds: profile.specialties.map((specialty) => specialty.id) },
  })

  async function save({ specialtyIds }: SpecialtyFormValues) {
    setFormError(null)
    if (!rights.identity) return
    try {
      await professionalPortalService.setSpecialties(specialtyIds)
      toast.show('Especialidades guardadas.')
      onSaved()
    } catch (error) {
      // Ex.: CONFLICT ao retirar uma especialidade que tem ofertas ativas.
      setFormError(errorMessage(error))
    }
  }

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
      {!rights.identity && <LockedNotice>{LOCKED_IDENTITY_TEXT}</LockedNotice>}
      <fieldset disabled={!rights.identity} className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Especialidades (de 1 a 5)</legend>
        {catalog.map((specialty) => (
          <Checkbox
            key={specialty.id}
            value={specialty.id}
            label={
              <>
                {specialty.name}
                <span className="block text-xs text-muted">{categoryLabel[specialty.category]}</span>
              </>
            }
            {...register('specialtyIds')}
          />
        ))}
      </fieldset>
      <FormError message={formError ?? errors.specialtyIds?.message ?? null} />
      {rights.identity && (
        <div>
          <Button type="submit" loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      )}
    </form>
  )
}

/** Perfil do profissional (UC-MKT-03, `GET/PATCH /professional-portal/me`, `PUT …/specialties`). */
export function ProfessionalProfilePage() {
  usePageTitle('Perfil')
  const { state, reload, profile } = useProfessionalProfile()
  const catalog = useAsync(() => professionalPortalService.listSpecialtyCatalog(), [])

  // Guarda o último perfil carregado: o reload depois de guardar não desmonta os formulários.
  const [current, setCurrent] = useState<ProfessionalProfile | null>(null)
  useEffect(() => {
    if (profile) setCurrent(profile)
  }, [profile])

  if (!current) {
    return (
      <>
        <h1 className="text-xl font-semibold">Perfil</h1>
        {state.status === 'error' ? <ErrorState onRetry={reload} /> : <LoadingState rows={2} />}
      </>
    )
  }

  const rights = editRights(current.validationStatus)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Perfil</h1>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold">Dados do perfil</h2>
        {!rights.profileText && (
          <LockedNotice>Perfil em modo só de leitura: não é possível alterar os dados.</LockedNotice>
        )}
        <ProfileForm profile={current} rights={rights} onSaved={reload} />
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold">Especialidades</h2>
        {catalog.state.status === 'loading' && <LoadingState rows={2} />}
        {catalog.state.status === 'error' && <ErrorState onRetry={catalog.reload} />}
        {catalog.state.status === 'success' && (
          <SpecialtiesForm profile={current} catalog={catalog.state.data} rights={rights} onSaved={reload} />
        )}
      </Card>
    </div>
  )
}
