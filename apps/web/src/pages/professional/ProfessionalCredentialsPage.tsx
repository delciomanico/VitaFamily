import { useState } from 'react'
import { Download, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet } from '@/components/app/Sheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { todayISO } from '@/lib/date'
import { saveBlob } from '@/lib/download'
import { errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { credentialKindLabel, formatFileSize, scanStatusLabel, scanStatusTone } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { CredentialContentType, ProfessionalCredential } from '@/types/professional'

const EXTENSIONS: Record<CredentialContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** Documentos do profissional (UC-MKT-04, BR-MKT-16/17): envio (passo a passo), verificação, descarregamento e remoção. */
export function ProfessionalCredentialsPage() {
  usePageTitle('Os meus documentos')
  const toast = useToast()
  const { state: profileState, profile, rights, reload: reloadProfile } = useProfessionalProfile()
  const { state, reload } = useAsync(() => professionalPortalService.listCredentials(), [])
  const [removing, setRemoving] = useState<ProfessionalCredential | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canEdit = rights?.identity === true
  const today = todayISO()
  const categories = new Set(profile?.specialties.map((specialty) => specialty.category))

  async function download(credential: ProfessionalCredential) {
    setBusyId(credential.id)
    try {
      const blob = await professionalPortalService.downloadCredential(credential.id)
      saveBlob(blob, `credencial-${credential.kind}.${EXTENSIONS[credential.contentType]}`)
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setRemoveLoading(true)
    try {
      await professionalPortalService.deleteCredential(removing.id)
      toast.show('Documento removido.')
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setRemoveLoading(false)
      setRemoving(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Os meus documentos" backTo={paths.professionalProfile} backLabel="Perfil" subtitle="Para a equipa validar o seu perfil." />

      {profileState.status === 'error' && <ErrorState onRetry={reloadProfile} />}
      {rights && !rights.identity && <LockedNotice>Os documentos só se alteram enquanto o perfil está a ser preenchido ou quando a equipa pede mais informação.</LockedNotice>}

      {canEdit && (
        <ButtonLink to={paths.professionalCredentialNew} size="xl" fullWidth icon={<Plus className="size-6" aria-hidden />}>
          Carregar documento
        </ButtonLink>
      )}

      <AccordionSection title="O que preciso de enviar" icon={FileText} summary="Documentos exigidos">
        {categories.has('HEALTH') && (
          <p className="text-base">
            Especialidades de saúde: {credentialKindLabel.IDENTITY.toLowerCase()} e {credentialKindLabel.PROFESSIONAL_LICENSE.toLowerCase()}.
          </p>
        )}
        {categories.has('WELLNESS') && (
          <p className="text-base">
            Especialidades de bem-estar: {credentialKindLabel.IDENTITY.toLowerCase()} e {credentialKindLabel.CERTIFICATION.toLowerCase()}.
          </p>
        )}
        {profile && categories.size === 0 && <p className="text-base">Escolha as suas especialidades no perfil para ver os documentos exigidos.</p>}
        <p className="text-base text-muted">Aceita-se PDF, JPG ou PNG, até 10 MB.</p>
      </AccordionSection>

      <section className="flex flex-col gap-3" aria-labelledby="credential-list-title">
        <h2 id="credential-list-title" className="text-xl font-semibold">
          Documentos enviados
        </h2>
        {state.status === 'loading' && <LoadingState rows={2} />}
        {state.status === 'error' && <ErrorState onRetry={reload} />}
        {state.status === 'success' &&
          (state.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong px-6 py-8 text-center">
              <FileText className="size-10 text-muted" aria-hidden />
              <p className="text-lg font-semibold">Ainda não enviou documentos</p>
              <p className="text-base text-muted">{canEdit ? 'Comece pela sua identificação.' : 'Quando enviar, aparecem aqui.'}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.data.map((credential) => {
                const title = credentialKindLabel[credential.kind]
                const expired = credential.validUntil !== undefined && credential.validUntil < today
                return (
                  <li key={credential.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold">{title}</h3>
                      <span className="flex flex-wrap gap-2">
                        <Badge tone={scanStatusTone[credential.scanStatus]} dot>
                          {scanStatusLabel[credential.scanStatus]}
                        </Badge>
                        {expired && <Badge tone="danger">Caducado</Badge>}
                      </span>
                    </div>
                    <div className="flex flex-col text-base text-muted">
                      {credential.number && <p>Nº {credential.number}</p>}
                      {credential.issuingBody && <p>{credential.issuingBody}</p>}
                      <p>{credential.validUntil ? `Validade: ${formatShortDate(credential.validUntil)}` : 'Sem data de validade'}</p>
                      <p>{formatFileSize(credential.sizeBytes)}</p>
                    </div>
                    {credential.scanStatus === 'PENDING' && (
                      <div className="flex flex-col gap-2">
                        <p className="text-base text-muted">A verificar o ficheiro…</p>
                        <Button variant="secondary" size="lg" fullWidth onClick={reload} aria-label={`Atualizar o estado de ${title}`} icon={<RefreshCw className="size-5" aria-hidden />}>
                          Atualizar
                        </Button>
                      </div>
                    )}
                    {credential.scanStatus === 'INFECTED' && <p className="text-base text-danger">O antivírus rejeitou este ficheiro e não pode ser descarregado. Remova-o e carregue outro.</p>}
                    {credential.scanStatus === 'CLEAN' && (
                      <Button variant="soft" size="lg" fullWidth onClick={() => void download(credential)} loading={busyId === credential.id} aria-label={`Descarregar ${title}`} icon={busyId !== credential.id ? <Download className="size-5" aria-hidden /> : undefined}>
                        Descarregar
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="danger-ghost" size="lg" fullWidth onClick={() => setRemoving(credential)} aria-label={`Remover ${title}`} icon={<Trash2 className="size-5" aria-hidden />}>
                        Remover
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </section>

      <ConfirmSheet
        open={removing !== null}
        title="Remover este documento?"
        description="O ficheiro é apagado e deixa de poder ser descarregado."
        yesLabel="Sim, remover"
        destructive
        loading={removeLoading}
        onYes={() => void confirmRemove()}
        onNo={() => setRemoving(null)}
      />
    </div>
  )
}
