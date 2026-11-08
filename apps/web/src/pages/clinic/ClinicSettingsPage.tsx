import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, History, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { clinicReceiptService } from '@/services/clinicReceipt.service'
import type { ClinicProfile, ClinicProfileField, ClinicProfileInput } from '@/types/clinicReceipt'
import { PROFILE_LIMITS } from '@/types/clinicReceipt'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Draft = Record<ClinicProfileField, string>

const toDraft = (profile: ClinicProfile): Draft => ({
  displayName: profile.displayName ?? '',
  address: profile.address ?? '',
  phone: profile.phone ?? '',
  email: profile.email ?? '',
  openingHours: profile.openingHours ?? '',
  description: profile.description ?? '',
})

/** Perfil da clínica (UC-CLN-29, BR-CLN-38): o Admin edita; o Gestor lê. É o que a app mostra ao paciente. */
function ProfileForm({ profile, canEdit, onSaved }: { profile: ClinicProfile; canEdit: boolean; onSaved: (p: ClinicProfile) => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const initial = toDraft(profile)
  const changed = (Object.keys(draft) as ClinicProfileField[]).filter((field) => draft[field].trim() !== initial[field])

  function set(field: ClinicProfileField, value: string) {
    setDraft({ ...draft, [field]: value })
    setError(null)
  }

  async function save() {
    for (const field of changed) {
      if (draft[field].trim().length > PROFILE_LIMITS[field]) return setError('Um dos campos é demasiado longo.')
    }
    if (changed.includes('email') && draft.email.trim() && !EMAIL_PATTERN.test(draft.email.trim())) {
      return setError('Introduza um e-mail de contacto válido.')
    }
    // Parcial: só os campos alterados; vazio limpa (`null`), e o nome de apresentação vazio volta a usar o nome da clínica.
    const input: ClinicProfileInput = {}
    for (const field of changed) input[field] = draft[field].trim() || null
    setSaving(true)
    try {
      const saved = await clinicReceiptService.updateProfile(input)
      toast.show('Perfil atualizado.')
      setDraft(toDraft(saved))
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const common = { disabled: !canEdit } as const
  return (
    <Card className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome da clínica" value={profile.name} readOnly disabled hint="Definido pela equipa Vita Family." />
        <Input label="Moeda" value={profile.currency} readOnly disabled hint="Só leitura." />
      </div>
      <Input
        label="Nome de apresentação"
        hint={`É o nome que o paciente vê na app. Vazio: usa “${profile.name}”.`}
        maxLength={PROFILE_LIMITS.displayName}
        value={draft.displayName}
        onChange={(e) => set('displayName', e.target.value)}
        {...common}
      />
      <Input label="Morada" maxLength={PROFILE_LIMITS.address} value={draft.address} onChange={(e) => set('address', e.target.value)} {...common} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Telefone" inputMode="tel" maxLength={PROFILE_LIMITS.phone} value={draft.phone} onChange={(e) => set('phone', e.target.value)} {...common} />
        <Input label="E-mail de contacto" type="email" maxLength={PROFILE_LIMITS.email} value={draft.email} onChange={(e) => set('email', e.target.value)} {...common} />
      </div>
      <Textarea
        label="Horário de funcionamento"
        hint="Texto livre, por exemplo: Seg a Sex 08:00–18:00."
        rows={2}
        maxLength={PROFILE_LIMITS.openingHours}
        value={draft.openingHours}
        onChange={(e) => set('openingHours', e.target.value)}
        {...common}
      />
      <Textarea
        label="Descrição"
        hint="Uma ou duas frases sobre a clínica. Sem dados de pacientes."
        rows={3}
        maxLength={PROFILE_LIMITS.description}
        value={draft.description}
        onChange={(e) => set('description', e.target.value)}
        {...common}
      />
      <FormError message={error} />
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={changed.length === 0}>
            Guardar
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Só o Admin da clínica pode alterar o perfil.</p>
      )}
    </Card>
  )
}

/** Definições → Perfil da clínica (e atalhos para Equipa e Auditoria, só do Admin). */
export function ClinicSettingsPage() {
  const { isAdmin } = useClinicAuth()
  const { state, reload } = useAsync(() => clinicReceiptService.getProfile(), [])

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Definições</h1>
        <h2 className="text-sm font-medium text-muted">Perfil da clínica</h2>
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <ProfileForm profile={state.data} canEdit={isAdmin} onSaved={() => undefined} />}

      {isAdmin && (
        <section className="flex max-w-2xl flex-col gap-2" aria-label="Mais definições">
          <Link to={paths.clinicStaff} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card hover:bg-surface-muted">
            <Users className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              <span className="block font-medium">Equipa e papéis</span>
              <span className="block text-sm text-muted">Criar contas de receção e de Médico.</span>
            </span>
            <ChevronRight className="size-5 text-muted" aria-hidden />
          </Link>
          <Link to={paths.clinicAudit} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card hover:bg-surface-muted">
            <History className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              <span className="block font-medium">Auditoria</span>
              <span className="block text-sm text-muted">Quem da equipa fez o quê e quando.</span>
            </span>
            <ChevronRight className="size-5 text-muted" aria-hidden />
          </Link>
        </section>
      )}
    </>
  )
}
