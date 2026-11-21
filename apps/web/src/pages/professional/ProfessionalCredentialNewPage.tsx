import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { ChoiceList } from '@/components/app/ChoiceList'
import { SheetNotice, SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { useWizardStep } from '@/hooks/useWizardStep'
import { MAX_ENTITY, MAX_NUMBER, uploadErrorMessage } from '@/lib/credentials'
import { useDraft } from '@/lib/draft'
import { useModalRoute } from '@/lib/modalRoute'
import { CREDENTIAL_MAX_BYTES, CREDENTIAL_TYPES, credentialKindLabel, formatFileSize } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { CredentialKind } from '@/types/professional'

const KINDS: CredentialKind[] = ['IDENTITY', 'PROFESSIONAL_LICENSE', 'CERTIFICATION']
const KIND_HINT: Record<CredentialKind, string> = {
  IDENTITY: 'Bilhete de identidade ou passaporte',
  PROFESSIONAL_LICENSE: 'Cédula ou inscrição na ordem profissional',
  CERTIFICATION: 'Diploma ou certificado do seu curso',
}
const TITLES = ['Que documento é?', 'Escolha o ficheiro', 'Mais alguns dados'] as const

interface Draft {
  kind: CredentialKind | ''
  number: string
  issuingBody: string
  validUntil: string
}

/** Enviar um documento (UC-MKT-04, BR-MKT-16/17): tipo, ficheiro e dados opcionais. O ficheiro não entra no rascunho. */
function CredentialWizard() {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const { close, saved } = useModalRoute(paths.professionalCredentials)
  const { step, next, back, last } = useWizardStep(TITLES.length, close)
  const [draft, update, clearDraft] = useDraft<Draft>('credential', { kind: '', number: '', issuingBody: '', validUntil: '' })
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const change = (patch: Partial<Draft>) => {
    setError(null)
    update(patch)
  }

  function problem(): string | null {
    if (step === 0 && !draft.kind) return 'Escolha o tipo de documento.'
    if (step === 1) {
      if (!file) return 'Escolha o ficheiro a enviar.'
      if (!CREDENTIAL_TYPES.includes(file.type)) return 'Use um ficheiro PDF, JPG ou PNG.'
      if (file.size > CREDENTIAL_MAX_BYTES) return 'O ficheiro tem mais de 10 MB. Escolha um mais pequeno.'
    }
    if (step === 2) {
      if (draft.number.trim().length > MAX_NUMBER) return `O número pode ter até ${MAX_NUMBER} caracteres.`
      if (draft.issuingBody.trim().length > MAX_ENTITY) return `A entidade pode ter até ${MAX_ENTITY} caracteres.`
    }
    return null
  }

  async function send() {
    if (!draft.kind || !file) return
    setSending(true)
    try {
      await professionalPortalService.uploadCredential({
        kind: draft.kind,
        number: draft.number.trim() || undefined,
        issuingBody: draft.issuingBody.trim() || undefined,
        validUntil: draft.validUntil || undefined,
        file,
      })
      clearDraft()
      toast.show('Documento enviado. Está em verificação.')
      saved()
    } catch (failure) {
      setError(uploadErrorMessage(failure))
    } finally {
      setSending(false)
    }
  }

  function onNext() {
    const found = problem()
    if (found) return setError(found)
    setError(null)
    if (!last) return next()
    void send()
  }

  return (
    <WizardSheet
      onClose={close}
      onDiscard={clearDraft}
      dirty={Boolean(file || draft.kind || draft.number || draft.issuingBody || draft.validUntil)}
      title="Enviar documento"
      stepTitle={TITLES[step] ?? ''}
      description={step === 1 ? 'PDF, JPG ou PNG, até 10 MB. Pode tirar uma fotografia.' : step === 2 ? 'Tudo opcional.' : undefined}
      step={step}
      total={TITLES.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Enviar documento' : 'Continuar'}
      busy={sending}
      error={error}
    >
      {step === 0 && <ChoiceList legend="Tipo de documento" hideLegend options={KINDS.map((kind) => ({ value: kind, label: credentialKindLabel[kind], hint: KIND_HINT[kind] }))} value={draft.kind} onChange={(kind) => change({ kind })} />}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface p-5 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">
            <FileUp className="size-8 text-primary" aria-hidden />
            <span className="text-lg font-semibold">{file ? 'Escolher outro ficheiro' : 'Escolher ficheiro'}</span>
            <input
              ref={fileInput}
              type="file"
              aria-label="Ficheiro"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setError(null)
              }}
            />
          </label>
          {file && (
            <p className="rounded-xl bg-primary-soft px-4 py-3 text-base break-all text-primary">
              {file.name} · {formatFileSize(file.size)}
            </p>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Input label="Número (opcional)" value={draft.number} maxLength={MAX_NUMBER} onChange={(event) => change({ number: event.target.value })} />
          <Input label="Entidade emissora (opcional)" value={draft.issuingBody} maxLength={MAX_ENTITY} onChange={(event) => change({ issuingBody: event.target.value })} />
          <Input label="Validade (opcional)" type="date" value={draft.validUntil} onChange={(event) => change({ validUntil: event.target.value })} hint="Se a data já passou, o documento fica como caducado." />
        </div>
      )}
    </WizardSheet>
  )
}

export function ProfessionalCredentialNewPage() {
  usePageTitle('Enviar documento')
  const { state, reload, profile, rights } = useProfessionalProfile()
  const { close } = useModalRoute(paths.professionalCredentials)
  if (state.status === 'error' || !profile || !rights) return <SheetWait title="Enviar documento" onClose={close} onRetry={reload} failed={state.status === 'error'} />
  if (!rights.identity)
    return (
      <SheetNotice title="Enviar documento" onClose={close} closeLabel="Voltar aos documentos">
        <LockedNotice>Os documentos só se alteram enquanto o perfil está a ser preenchido ou quando a equipa pede mais informação.</LockedNotice>
      </SheetNotice>
    )
  return <CredentialWizard />
}
