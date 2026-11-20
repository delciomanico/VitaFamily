import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { SCREENSHOT_NOTICE, SHARE_CONSENT_NOTICE, VIEW_ONCE_NOTICE, categoryLabel, validityLabel } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { recordShareService } from '@/services/recordShare.service'
import type { RecordShareCategory, RecordShareOptions, ShareValidity } from '@/types/recordSharing'

/** Partilhar o registo com o profissional de uma marcação confirmada: categorias, prazo e aviso de capturas (UC-MKT-48/49). */
export function ShareCreatePage() {
  usePageTitle('Partilhar o registo')
  const { user, family } = useAuth()
  const { memberId = '', bookingId = '' } = useParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const options = useAsync(() => recordShareService.options(familyId, userId, memberId, bookingId), [familyId, userId, memberId, bookingId])
  const back = paths.booking(memberId, bookingId)

  return (
    <Page title="Partilhar o registo" backTo={back} backLabel="Marcação">
      {options.state.status === 'loading' && <LoadingState rows={3} />}
      {options.state.status === 'error' &&
        (isAppError(options.state.error, 'NOT_FOUND') || isAppError(options.state.error, 'INVALID_STATE_TRANSITION') || isAppError(options.state.error, 'CONFLICT') ? (
          <EmptyState icon={CircleSlash} title="Só pode partilhar numa marcação confirmada." description="Quando o profissional confirmar a marcação, volte aqui." />
        ) : (
          <ErrorState message={errorMessage(options.state.error)} onRetry={options.reload} />
        ))}
      {options.state.status === 'success' && <ShareForm options={options.state.data} memberId={memberId} />}
    </Page>
  )
}

function ShareForm({ options, memberId }: { options: RecordShareOptions; memberId: string }) {
  const { user, family } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const requestId = useRef(crypto.randomUUID())
  const [categories, setCategories] = useState<RecordShareCategory[]>([])
  const [validity, setValidity] = useState<ShareValidity | ''>('')
  const [viewOnce, setViewOnce] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const full = options.activeCount >= options.maxActive

  const toggle = (category: RecordShareCategory) => setCategories((current) => (current.includes(category) ? current.filter((c) => c !== category) : [...current, category]))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (categories.length === 0) return setError('Escolha pelo menos uma categoria.')
    if (!validity) return setError('Escolha durante quanto tempo.')
    if (!understood) return setError('Confirme que leu o aviso para partilhar.')
    setError(null)
    setSending(true)
    try {
      const share = await recordShareService.create(family?.id ?? '', user?.id ?? '', memberId, { bookingId: options.bookingId, categories, validity, viewOnce, clientRequestId: requestId.current })
      toast.show('Registo partilhado.')
      navigate(paths.share(memberId, share.id))
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
      <Card className="flex flex-col gap-1">
        <p className="text-sm text-muted">Partilhar com</p>
        <h2 className="text-lg font-semibold">{options.professional.displayName}</h2>
        <p className="text-sm text-muted">O profissional só vê o que escolher aqui, e nada mais do seu registo.</p>
      </Card>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">O que quer partilhar?</legend>
        {options.professionalCategory === 'WELLNESS' && <p className="text-sm text-muted">Com este tipo de profissional só pode partilhar a medicação ativa.</p>}
        {options.allowedCategories.map((category) => (
          <Checkbox key={category} label={categoryLabel[category]} checked={categories.includes(category)} onChange={() => toggle(category)} />
        ))}
        <p className="text-xs text-muted">Notas, motivos, documentos e o seu nome ou data de nascimento nunca são partilhados. O profissional vê apenas a sua idade.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Durante quanto tempo?</legend>
        {options.validities.map((item) => (
          <label key={item.validity} className="flex cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <input
              type="radio"
              name="validity"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              value={item.validity}
              checked={validity === item.validity}
              disabled={!item.eligible}
              onChange={() => setValidity(item.validity)}
            />
            <span>
              {validityLabel[item.validity]}
              <span className="block text-muted">{item.eligible ? `Termina ${formatWhenLuanda(item.expiresAt)}` : 'Já não é possível: o prazo já passou.'}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted">Depois de criada, a partilha não se prolonga: se precisar de mais tempo, crie outra.</p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Checkbox label="Só pode ser aberta uma vez" checked={viewOnce} onChange={(event) => setViewOnce(event.target.checked)} disabled={!options.viewOnceAllowed} />
        <p className="text-xs text-muted">{VIEW_ONCE_NOTICE}</p>
      </div>

      <div role="note" className="flex flex-col gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-sm">
        <p className="font-medium">{SCREENSHOT_NOTICE}</p>
        <p className="text-xs">{SHARE_CONSENT_NOTICE}</p>
      </div>
      <Checkbox label="Li o aviso e quero partilhar" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />

      {full && <p className="text-sm text-warning">Já tem {options.maxActive} partilhas ativas para este membro. Pare uma para criar outra.</p>}
      <FormError message={error} />
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" loading={sending} disabled={full} className="sm:flex-1">
          Partilhar
        </Button>
      </div>
    </form>
  )
}
