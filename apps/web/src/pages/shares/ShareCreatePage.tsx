import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import { SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Sheet } from '@/components/app/Sheet'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { SCREENSHOT_NOTICE, SHARE_CONSENT_NOTICE, VIEW_ONCE_NOTICE, categoryLabel, validityLabel } from '@/lib/recordSharing'
import { useModalRoute } from '@/lib/modalRoute'
import { useWizardStep } from '@/hooks/useWizardStep'
import { paths } from '@/routes/paths'
import { recordShareService } from '@/services/recordShare.service'
import type { RecordShareCategory, RecordShareOptions, ShareValidity } from '@/types/recordSharing'

const STEPS = ['O que quer partilhar?', 'Durante quanto tempo?', 'Antes de partilhar'] as const

/** Partilhar o registo com o profissional de uma marcação confirmada, passo a passo numa folha por cima da marcação (UC-MKT-48/49). */
export function ShareCreatePage() {
  usePageTitle('Partilhar o registo')
  const { user, family } = useAuth()
  const { memberId = '', bookingId = '' } = useParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const options = useAsync(() => recordShareService.options(familyId, userId, memberId, bookingId), [familyId, userId, memberId, bookingId])
  const { close } = useModalRoute(paths.booking(memberId, bookingId))

  if (options.state.status === 'loading') return <SheetWait title="Partilhar o registo" onClose={close} />
  if (options.state.status === 'error') {
    const notConfirmed = isAppError(options.state.error, 'NOT_FOUND') || isAppError(options.state.error, 'INVALID_STATE_TRANSITION') || isAppError(options.state.error, 'CONFLICT')
    return (
      <Sheet
        open
        onClose={close}
        title="Partilhar o registo"
        footer={
          notConfirmed ? undefined : (
            <Button size="xl" fullWidth onClick={options.reload}>
              Tentar de novo
            </Button>
          )
        }
      >
        {notConfirmed ? (
          <EmptyState icon={CircleSlash} title="Só pode partilhar numa marcação confirmada." description="Quando o profissional confirmar a marcação, volte aqui." />
        ) : (
          <p className="text-base text-muted">{errorMessage(options.state.error)}</p>
        )}
      </Sheet>
    )
  }
  return <ShareForm options={options.state.data} memberId={memberId} bookingId={bookingId} />
}

function ShareForm({ options, memberId, bookingId }: { options: RecordShareOptions; memberId: string; bookingId: string }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const { close, saved } = useModalRoute(paths.booking(memberId, bookingId))
  const { step, next, back, last } = useWizardStep(STEPS.length, close)
  const requestId = useRef(crypto.randomUUID())
  const [categories, setCategories] = useState<RecordShareCategory[]>([])
  const [validity, setValidity] = useState<ShareValidity | ''>('')
  const [viewOnce, setViewOnce] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const full = options.activeCount >= options.maxActive

  const toggle = (category: RecordShareCategory) => {
    setError(null)
    setCategories((current) => (current.includes(category) ? current.filter((c) => c !== category) : [...current, category]))
  }

  async function submit() {
    setError(null)
    setSending(true)
    try {
      await recordShareService.create(family?.id ?? '', user?.id ?? '', memberId, { bookingId: options.bookingId, categories, validity: validity as ShareValidity, viewOnce, clientRequestId: requestId.current })
      toast.show('Registo partilhado.')
      saved()
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
    }
  }

  function onNext() {
    if (step === 0 && categories.length === 0) return setError('Escolha pelo menos uma categoria.')
    if (step === 1 && !validity) return setError('Escolha durante quanto tempo.')
    if (step === 2 && !understood) return setError('Confirme que leu o aviso para partilhar.')
    setError(null)
    if (!last) return next()
    void submit()
  }

  return (
    <WizardSheet
      title="Partilhar o registo"
      stepTitle={STEPS[step] ?? ''}
      step={step}
      total={STEPS.length}
      onBack={() => {
        setError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Partilhar' : 'Continuar'}
      nextDisabled={full}
      busy={sending}
      error={error}
      dirty={categories.length > 0 || validity !== ''}
      onClose={close}
    >
      {step === 0 && (
        <>
          <Card className="flex flex-col gap-1">
            <p className="text-sm text-muted">Partilhar com</p>
            <h2 className="text-lg font-semibold">{options.professional.displayName}</h2>
            <p className="text-sm text-muted">O profissional só vê o que escolher aqui, e nada mais do seu registo.</p>
          </Card>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">O que quer partilhar?</legend>
            {options.professionalCategory === 'WELLNESS' && <p className="text-sm text-muted">Com este tipo de profissional só pode partilhar a medicação ativa.</p>}
            {options.allowedCategories.map((category) => (
              <Checkbox key={category} label={categoryLabel[category]} checked={categories.includes(category)} onChange={() => toggle(category)} />
            ))}
            <p className="text-sm text-muted">Notas, motivos, documentos e o seu nome ou data de nascimento nunca são partilhados. O profissional vê apenas a sua idade.</p>
          </fieldset>
          {full && <p className="text-base text-warning">Já tem {options.maxActive} partilhas ativas para este membro. Pare uma para criar outra.</p>}
        </>
      )}

      {step === 1 && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Durante quanto tempo?</legend>
            {options.validities.map((item) => (
              <label key={item.validity} className="flex cursor-pointer items-start gap-3 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  type="radio"
                  name="validity"
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                  value={item.validity}
                  checked={validity === item.validity}
                  disabled={!item.eligible}
                  onChange={() => {
                    setError(null)
                    setValidity(item.validity)
                  }}
                />
                <span>
                  {validityLabel[item.validity]}
                  <span className="block text-muted">{item.eligible ? `Termina ${formatWhenLuanda(item.expiresAt)}` : 'Já não é possível: o prazo já passou.'}</span>
                </span>
              </label>
            ))}
            <p className="text-sm text-muted">Depois de criada, a partilha não se prolonga: se precisar de mais tempo, crie outra.</p>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Checkbox label="Só pode ser aberta uma vez" checked={viewOnce} onChange={(event) => setViewOnce(event.target.checked)} disabled={!options.viewOnceAllowed} />
            <p className="text-sm text-muted">{VIEW_ONCE_NOTICE}</p>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div role="note" className="flex flex-col gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-base">
            <p className="font-medium">{SCREENSHOT_NOTICE}</p>
            <p className="text-sm">{SHARE_CONSENT_NOTICE}</p>
          </div>
          <Checkbox label="Li o aviso e quero partilhar" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
        </>
      )}
    </WizardSheet>
  )
}
