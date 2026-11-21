import { useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Camera, CalendarClock, FileBadge, LogOut, Share2, Star, Tags, Trash2, UserPen } from 'lucide-react'
import { ListEntry } from '@/components/app/ListEntry'
import { ProfessionalAvatar } from '@/components/app/ProfessionalAvatar'
import { TabHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet } from '@/components/app/Sheet'
import { ValidationStatusBadge } from '@/components/professional/ValidationStatusBadge'
import { Button } from '@/components/ui/Button'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useProfessionalAuth } from '@/contexts/ProfessionalAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { clearProfessionalDrafts } from '@/lib/draft'
import { formatCount } from '@/lib/format'
import { photoToDataUrl, saveProfessionalPhoto, useProfessionalPhoto } from '@/lib/professionalPhoto'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import { professionalPortalService } from '@/services/professionalPortal.service'
import { professionalShareService } from '@/services/professionalShare.service'

/** Separador «Perfil»: a pessoa (foto, nome, estado) e uma lista simples das áreas da conta, cada uma com o seu estado. */
export function ProfessionalProfileHubPage() {
  usePageTitle('Perfil')
  const toast = useToast()
  const navigate = useNavigate()
  const { logout } = useProfessionalAuth()
  const { state, reload, profile } = useProfessionalProfile()
  const offers = useAsync(() => professionalPortalService.listOffers(true), [])
  const rules = useAsync(() => professionalPortalService.listScheduleRules({ active: true }), [])
  const credentials = useAsync(() => professionalPortalService.listCredentials(), [])
  const reviews = useAsync(() => professionalBookingService.reviews({ unanswered: true }), [])
  const shares = useAsync(() => professionalShareService.list(), [])
  const photo = useProfessionalPhoto(profile?.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  if (state.status === 'loading') return <LoadingState rows={3} />
  if (state.status === 'error' || !profile) return <ErrorState onRetry={reload} />

  const name = profile.displayName ?? 'O seu nome'

  async function onPhoto(file: File | undefined) {
    if (!file || !profile) return
    setPhotoError(null)
    try {
      saveProfessionalPhoto(profile.id, await photoToDataUrl(file))
      toast.show('Foto atualizada.')
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Não foi possível usar esta imagem.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function signOut() {
    clearProfessionalDrafts()
    await logout()
    navigate(paths.professionalLogin, { replace: true })
  }

  const countText = (items: unknown[] | null, one: string, many: string, none: string) =>
    items === null ? undefined : items.length === 0 ? none : formatCount(items.length, one, many)
  const offerItems = offers.state.status === 'success' ? offers.state.data : null
  const ruleItems = rules.state.status === 'success' ? rules.state.data : null
  const credentialItems = credentials.state.status === 'success' ? credentials.state.data : null
  const unanswered = reviews.state.status === 'success' ? reviews.state.data.items.length : null
  const availableShares = shares.state.status === 'success' ? shares.state.data.items.filter((s) => s.status === 'ACTIVE' && s.canOpen).length : null

  return (
    <div className="flex flex-col gap-6">
      <TabHeader title="Perfil" />

      <section aria-label="A sua conta" className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-6 text-center shadow-card">
        <ProfessionalAvatar professionalId={profile.id} name={name} size="xl" className="size-24 text-3xl" />
        <div className="flex flex-col items-center gap-2">
          <p className="text-xl font-semibold">{name}</p>
          <p className="text-base break-all text-muted">{profile.email}</p>
          <ValidationStatusBadge status={profile.validationStatus} />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-primary-soft px-5 text-base font-medium text-primary hover:bg-primary-soft-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">
            <Camera className="size-5" aria-hidden />
            {photo ? 'Mudar a foto' : 'Adicionar foto'}
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={(event) => void onPhoto(event.target.files?.[0])} />
          </label>
          {photo && (
            <Button variant="ghost" icon={<Trash2 className="size-5" aria-hidden />} onClick={() => saveProfessionalPhoto(profile.id, null)}>
              Tirar a foto
            </Button>
          )}
        </div>
        <FormError message={photoError} />
        <p className="text-sm text-muted">A foto fica só neste aparelho.</p>
      </section>

      <nav aria-label="Áreas do perfil" className="flex flex-col gap-3">
        <ListEntry
          to={paths.professionalProfileEdit}
          icon={UserPen}
          tone="health"
          title="Os meus dados"
          subtitle={[profile.city, formatCount(profile.specialties.length, 'especialidade', 'especialidades')].filter(Boolean).join(' · ')}
        />
        <ListEntry to={paths.professionalOffers} icon={Tags} tone="chat" title="Os meus serviços" subtitle={countText(offerItems, 'serviço ativo', 'serviços ativos', 'Ainda sem serviços')} />
        <ListEntry to={paths.professionalSchedule} icon={CalendarClock} tone="meds" title="Os meus horários" subtitle={countText(ruleItems, 'regra ativa', 'regras ativas', 'Ainda sem horários')} />
        <ListEntry to={paths.professionalCredentials} icon={FileBadge} tone="family" title="Os meus documentos" subtitle={countText(credentialItems, 'documento carregado', 'documentos carregados', 'Ainda sem documentos')} />
        <ListEntry
          to={paths.professionalReviews}
          icon={Star}
          tone="chat"
          title="Avaliações"
          subtitle={unanswered === null ? undefined : unanswered === 0 ? 'Todas respondidas' : formatCount(unanswered, 'por responder', 'por responder')}
        />
        <ListEntry
          to={paths.professionalShares}
          icon={Share2}
          tone="brand"
          title="Registos partilhados consigo"
          subtitle={availableShares === null ? undefined : availableShares === 0 ? 'Nada para abrir' : formatCount(availableShares, 'para abrir', 'para abrir')}
        />
      </nav>

      <Button variant="secondary" size="lg" fullWidth icon={<LogOut className="size-5" aria-hidden />} onClick={() => setLeaving(true)}>
        Sair
      </Button>

      <ConfirmSheet
        open={leaving}
        title="Quer mesmo sair?"
        description="Vai precisar de entrar outra vez com o seu e-mail e palavra-passe."
        yesLabel="Sim, sair"
        onYes={() => void signOut()}
        onNo={() => setLeaving(false)}
      />
      <Outlet context={{ onSaved: reload }} />
    </div>
  )
}
