import { useRef, useState, type FormEvent } from 'react'
import { Download, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { todayISO } from '@/lib/date'
import { saveBlob } from '@/lib/download'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import {
  CREDENTIAL_MAX_BYTES,
  CREDENTIAL_TYPES,
  credentialKindLabel,
  formatFileSize,
  scanStatusLabel,
  scanStatusTone,
} from '@/lib/professional'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { CredentialContentType, CredentialKind, ProfessionalCredential } from '@/types/professional'

const KINDS: CredentialKind[] = ['IDENTITY', 'PROFESSIONAL_LICENSE', 'CERTIFICATION']
const MAX_NUMBER = 60
const MAX_ENTITY = 120
const FILE_HELP = 'Use PDF, JPG ou PNG, até 10 MB.'
const EXTENSIONS: Record<CredentialContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * Mensagens de recusa do servidor. A genérica de `errorMessage` para ficheiros fala de CSV/XLSX (outro
 * módulo), por isso aqui usa-se a frase das credenciais.
 */
function uploadErrorMessage(error: unknown): string {
  if (isAppError(error, 'FILE_TYPE_NOT_ALLOWED')) return `Tipo de ficheiro não permitido. ${FILE_HELP}`
  if (isAppError(error, 'FILE_TOO_LARGE')) return `O ficheiro é demasiado grande. ${FILE_HELP}`
  if (isAppError(error, 'LIMIT_EXCEEDED')) return 'Já tem o máximo de 10 credenciais. Remova uma para juntar outra.'
  return errorMessage(error)
}

interface UploadErrors {
  kind?: string
  number?: string
  issuingBody?: string
  file?: string
}

/** Formulário de envio (UC-MKT-04): só existe enquanto o perfil permite alterar credenciais (BR-MKT-23). */
function CredentialUploadForm({ onUploaded }: { onUploaded: () => void }) {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<CredentialKind | ''>('')
  const [number, setNumber] = useState('')
  const [issuingBody, setIssuingBody] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<UploadErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next: UploadErrors = {}
    const trimmedNumber = number.trim()
    const trimmedBody = issuingBody.trim()

    if (!kind) next.kind = 'Escolha o tipo de credencial.'
    if (trimmedNumber.length > MAX_NUMBER) next.number = `O número pode ter até ${MAX_NUMBER} caracteres.`
    if (trimmedBody.length > MAX_ENTITY) next.issuingBody = `A entidade pode ter até ${MAX_ENTITY} caracteres.`
    if (!file) next.file = 'Escolha o ficheiro a enviar.'
    else if (!CREDENTIAL_TYPES.includes(file.type)) next.file = 'Use um ficheiro PDF, JPG ou PNG.'
    else if (file.size > CREDENTIAL_MAX_BYTES) next.file = 'O ficheiro tem mais de 10 MB. Escolha um ficheiro mais pequeno.'

    setErrors(next)
    if (!kind || !file || Object.keys(next).length > 0) return

    setFormError(null)
    setSending(true)
    try {
      await professionalPortalService.uploadCredential({
        kind,
        number: trimmedNumber || undefined,
        issuingBody: trimmedBody || undefined,
        validUntil: validUntil || undefined,
        file,
      })
      toast.show('Ficheiro enviado. Está em verificação.')
      setKind('')
      setNumber('')
      setIssuingBody('')
      setValidUntil('')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      onUploaded()
    } catch (err) {
      setFormError(uploadErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="credential-form-title">
        <h2 id="credential-form-title" className="font-semibold">
          Enviar credencial
        </h2>
        <Select
          label="Tipo"
          placeholder="Escolha o tipo"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as CredentialKind | '')
            setErrors((e) => ({ ...e, kind: undefined }))
          }}
          options={KINDS.map((value) => ({ value, label: credentialKindLabel[value] }))}
          error={errors.kind}
        />
        <Input
          label="Número (opcional)"
          value={number}
          maxLength={MAX_NUMBER}
          onChange={(event) => {
            setNumber(event.target.value)
            setErrors((e) => ({ ...e, number: undefined }))
          }}
          error={errors.number}
        />
        <Input
          label="Entidade emissora (opcional)"
          value={issuingBody}
          maxLength={MAX_ENTITY}
          onChange={(event) => {
            setIssuingBody(event.target.value)
            setErrors((e) => ({ ...e, issuingBody: undefined }))
          }}
          error={errors.issuingBody}
        />
        <Input
          label="Validade (opcional)"
          type="date"
          value={validUntil}
          onChange={(event) => setValidUntil(event.target.value)}
          hint="Se a data já tiver passado, a credencial fica marcada como caducada."
        />
        <Input
          ref={fileInput}
          label="Ficheiro"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="h-auto py-2"
          hint="PDF, JPG ou PNG, até 10 MB."
          error={errors.file}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setErrors((e) => ({ ...e, file: undefined }))
          }}
        />
        <FormError message={formError} />
        <Button type="submit" className="w-fit" loading={sending}>
          Enviar credencial
        </Button>
      </form>
    </Card>
  )
}

interface CredentialItemProps {
  credential: ProfessionalCredential
  today: string
  canEdit: boolean
  busy: boolean
  onDownload: () => void
  onRemove: () => void
  onRefresh: () => void
}

function CredentialItem({ credential, today, canEdit, busy, onDownload, onRemove, onRefresh }: CredentialItemProps) {
  const title = credentialKindLabel[credential.kind]
  const expired = credential.validUntil !== undefined && credential.validUntil < today

  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-medium">{title}</h3>
            {credential.number && <p className="text-sm text-muted">Nº {credential.number}</p>}
            {credential.issuingBody && <p className="text-sm text-muted">{credential.issuingBody}</p>}
            <p className="text-sm text-muted">
              {credential.validUntil ? `Validade: ${formatShortDate(credential.validUntil)}` : 'Sem data de validade'}
            </p>
            <p className="text-sm text-muted">{formatFileSize(credential.sizeBytes)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={scanStatusTone[credential.scanStatus]} dot>
              {scanStatusLabel[credential.scanStatus]}
            </Badge>
            {expired && <Badge tone="danger">Caducada</Badge>}
          </div>
        </div>

        {credential.scanStatus === 'PENDING' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">A verificar o ficheiro…</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              aria-label={`Atualizar o estado de ${title}`}
              icon={<RefreshCw className="size-4" aria-hidden />}
            >
              Atualizar
            </Button>
          </div>
        )}

        {credential.scanStatus === 'INFECTED' && (
          <p className="text-sm text-danger">
            O antivírus rejeitou este ficheiro e não pode ser descarregado. Remova-o e carregue outra.
          </p>
        )}

        {(credential.scanStatus === 'CLEAN' || canEdit) && (
          <div className="flex flex-wrap gap-2">
            {credential.scanStatus === 'CLEAN' && (
              <Button
                variant="soft"
                size="sm"
                onClick={onDownload}
                loading={busy}
                aria-label={`Descarregar ${title}`}
                icon={!busy ? <Download className="size-4" aria-hidden /> : undefined}
              >
                Descarregar
              </Button>
            )}
            {canEdit && (
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={onRemove}
                aria-label={`Remover ${title}`}
                icon={<Trash2 className="size-4" aria-hidden />}
              >
                Remover
              </Button>
            )}
          </div>
        )}
      </Card>
    </li>
  )
}

/** Credenciais do profissional (UC-MKT-04, BR-MKT-16/17): envio, verificação, descarregamento e remoção. */
export function ProfessionalCredentialsPage() {
  usePageTitle('Credenciais')
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
      toast.show('Credencial removida.')
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setRemoveLoading(false)
      setRemoving(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Credenciais</h1>

      {profileState.status === 'error' && <ErrorState onRetry={reloadProfile} />}

      <Card className="flex flex-col gap-2 text-sm text-muted">
        <p className="font-medium text-foreground">Credenciais exigidas</p>
        {categories.has('HEALTH') && (
          <p>
            Especialidades de saúde: {credentialKindLabel.IDENTITY.toLowerCase()} e{' '}
            {credentialKindLabel.PROFESSIONAL_LICENSE.toLowerCase()}.
          </p>
        )}
        {categories.has('WELLNESS') && (
          <p>
            Especialidades de bem-estar: {credentialKindLabel.IDENTITY.toLowerCase()} e{' '}
            {credentialKindLabel.CERTIFICATION.toLowerCase()}.
          </p>
        )}
        {profile && categories.size === 0 && <p>Escolha as especialidades no perfil para ver as credenciais exigidas.</p>}
        <p>Aceita-se PDF, JPG ou PNG, até 10 MB.</p>
      </Card>

      {rights && !rights.identity && (
        <LockedNotice>As credenciais só se alteram enquanto o perfil está a ser preenchido ou quando o administrador pede informação.</LockedNotice>
      )}

      {canEdit && <CredentialUploadForm onUploaded={reload} />}

      <section className="flex flex-col gap-3" aria-labelledby="credential-list-title">
        <h2 id="credential-list-title" className="font-semibold">
          As suas credenciais
        </h2>
        {state.status === 'loading' && <LoadingState rows={2} />}
        {state.status === 'error' && <ErrorState onRetry={reload} />}
        {state.status === 'success' &&
          (state.data.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Ainda não carregou credenciais."
              description={canEdit ? 'Envie a identificação e as credenciais da sua especialidade.' : undefined}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {state.data.map((credential) => (
                <CredentialItem
                  key={credential.id}
                  credential={credential}
                  today={today}
                  canEdit={canEdit}
                  busy={busyId === credential.id}
                  onDownload={() => download(credential)}
                  onRemove={() => setRemoving(credential)}
                  onRefresh={reload}
                />
              ))}
            </ul>
          ))}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title="Remover esta credencial?"
        description="O ficheiro é apagado e deixa de poder ser descarregado."
        confirmLabel="Remover"
        destructive
        loading={removeLoading}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
