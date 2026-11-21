import { useState, type FormEvent } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { CircleSlash, Download, FileText, MessageCircle, Share2, Wallet } from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet, Sheet } from '@/components/app/Sheet'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { MEETING_INFO_MAX, isStateChange, NOTE_MAX, NO_HEALTH_DATA_HINT, PROFESSIONAL_PROOF_NOTICE, cancellationText, paymentStatusText, plainText, proofStatusText, proofTypeLabel } from '@/lib/consultations'
import { saveBlob } from '@/lib/download'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatFileSize, formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import type { ProfessionalBooking } from '@/types/consultations'

type Action = 'confirm' | 'reject' | 'cancel' | 'reject-proof'
type Quick = 'confirm-proof' | 'complete' | 'no-show'

/** Marcação do profissional (UC-MKT-30..33, 36): resumo no topo, o próximo passo único e o detalhe em secções recolhidas. */
export function ProfessionalBookingPage() {
  const { bookingId = '' } = useParams()
  const profile = useProfessionalProfile()
  const { state, reload } = useAsync(() => professionalBookingService.get(bookingId), [bookingId])
  usePageTitle('Marcação')
  // Ao recarregar (depois de uma ação) mantém-se a marcação anterior em vez de piscar o carregamento.
  const [last, setLast] = useState<{ id: string; booking: ProfessionalBooking } | null>(null)
  if (state.status === 'success' && last?.booking !== state.data) setLast({ id: bookingId, booking: state.data })
  const shown = state.status === 'success' ? state.data : last?.id === bookingId ? last.booking : null
  const approved = profile.profile?.validationStatus === 'APPROVED'
  const back = <ScreenHeader title={shown?.participantLabel ?? 'Marcação'} backTo={paths.professionalBookings} backLabel="Marcações" />

  if (!shown && state.status === 'loading') return <div className="flex flex-col gap-5">{back}<LoadingState rows={3} /></div>
  if (state.status === 'error')
    return (
      <div className="flex flex-col gap-5">
        {back}
        {isAppError(state.error, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Marcação não encontrada." /> : <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-5">
      {back}
      {profile.profile && !approved && <LockedNotice>A sua conta não está aprovada: só pode consultar esta marcação.</LockedNotice>}
      {shown && <Detail booking={shown} approved={approved} onChanged={reload} />}
      <Outlet context={{ onSaved: reload }} />
    </div>
  )
}

function Detail({ booking, approved, onChanged }: { booking: ProfessionalBooking; approved: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [action, setAction] = useState<Action | null>(null)
  const [quick, setQuick] = useState<Quick | null>(null)
  const [busy, setBusy] = useState(false)
  const started = Date.parse(booking.startsAt) <= Date.now()
  const needsInfo = booking.offer.method === 'VIDEO' || booking.offer.method === 'PHONE'
  const proof = booking.proof
  const proofToDecide = approved && proof?.status === 'SUBMITTED' && proof.scanStatus === 'CLEAN'
  const hasPrescription = booking.canPrescribe || booking.hasPrescription
  const canShare = booking.status === 'CONFIRMED' || booking.status === 'COMPLETED'

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await task()
      toast.show(done)
    } catch (error) {
      toast.show(isStateChange(error) ? 'O pedido já mudou de estado. Atualizámos a página.' : errorMessage(error), 'error')
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  function answerQuick() {
    const choice = quick
    setQuick(null)
    if (choice === 'confirm-proof' && proof) void run(() => professionalBookingService.decideProof(booking.id, proof.id, { decision: 'CONFIRM' }), 'Pagamento confirmado.')
    if (choice === 'complete') void run(() => professionalBookingService.complete(booking.id), 'Consulta concluída.')
    if (choice === 'no-show') void run(() => professionalBookingService.noShow(booking.id), 'Falta registada.')
  }

  const quickText: Record<Quick, { title: string; text: string; yes: string }> = {
    'confirm-proof': { title: 'Confirmar que recebeu o pagamento?', text: 'Só confirme o que verificou na sua conta.', yes: 'Sim, confirmar' },
    complete: { title: 'A consulta já terminou?', text: 'A marcação passa a «Concluída».', yes: 'Sim, concluir' },
    'no-show': { title: 'A família não apareceu?', text: 'Fica registada uma falta nesta marcação.', yes: 'Sim, registar falta' },
  }

  return (
    <>
      <section aria-label="Resumo da marcação" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <p className="text-xl font-semibold">{formatWhenLuanda(booking.startsAt)}</p>
        <dl className="flex flex-col gap-2 text-base">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Consulta</dt>
            <dd className="text-end font-medium">
              {booking.offer.specialtyName} · {offerMethodLabel[booking.offer.method]} · {booking.offer.durationMinutes} min
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Preço</dt>
            <dd className="font-medium">{formatKz(booking.priceKz)}</dd>
          </div>
          {booking.meetingInfo && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{booking.offer.method === 'PHONE' ? 'Número a ligar' : 'Ligação'}</dt>
              <dd className="font-medium break-all">{booking.meetingInfo}</dd>
            </div>
          )}
        </dl>
        <StatusBadges status={booking.status} paymentStatus={booking.paymentStatus} priceKz={booking.priceKz} side="PROFESSIONAL" />
        {booking.status === 'CANCELLED' && (
          <p className="text-base">
            {cancellationText(booking.cancelledBy, booking.systemReason, 'PROFESSIONAL')}
            {booking.statusReason ? ` Nota: ${booking.statusReason}` : ''}
            {booking.cancelledLate ? ' Cancelada em cima da hora.' : ''}
          </p>
        )}
        {booking.status === 'REJECTED' && booking.statusReason && <p className="text-base">Motivo da recusa: {booking.statusReason}</p>}
      </section>

      {approved && booking.status === 'REQUESTED' && (
        <NextStep title="A família aguarda a sua resposta" text="Sem resposta em 48 horas, o pedido é cancelado.">
          <Button size="xl" fullWidth onClick={() => setAction('confirm')} disabled={busy}>
            Confirmar marcação
          </Button>
          <Button size="lg" variant="secondary" fullWidth onClick={() => setAction('reject')} disabled={busy}>
            Recusar
          </Button>
        </NextStep>
      )}

      {proofToDecide && (
        <NextStep title="Há um comprovativo para analisar" text="Abra a secção «Pagamento» para o ver. Depois confirme se recebeu o dinheiro.">
          <Button size="xl" fullWidth onClick={() => setQuick('confirm-proof')} disabled={busy}>
            Confirmar pagamento
          </Button>
          <Button size="lg" variant="secondary" fullWidth onClick={() => setAction('reject-proof')} disabled={busy}>
            Recusar comprovativo
          </Button>
        </NextStep>
      )}

      {approved && booking.status === 'CONFIRMED' && !proofToDecide &&
        (started ? (
          <NextStep title="Como correu a consulta?" text="A hora já passou. Indique o que aconteceu.">
            <Button size="xl" fullWidth onClick={() => setQuick('complete')} disabled={busy}>
              Concluir consulta
            </Button>
            <Button size="lg" variant="secondary" fullWidth onClick={() => setQuick('no-show')} disabled={busy}>
              Registar falta
            </Button>
          </NextStep>
        ) : (
          <section className="flex flex-col gap-3 rounded-2xl border border-success/30 bg-success-soft p-5">
            <h2 className="text-lg font-semibold text-success">Está tudo pronto</h2>
            <p className="text-base">Quando chegar a hora, volte aqui para concluir a consulta.</p>
            <Button variant="danger-ghost" size="lg" fullWidth onClick={() => setAction('cancel')} disabled={busy}>
              Cancelar marcação
            </Button>
          </section>
        ))}

      <div className="flex flex-col gap-3">
        {booking.priceKz > 0 && (
          <AccordionSection
            title="Pagamento"
            icon={Wallet}
            attention={proofToDecide}
            defaultOpen={proofToDecide}
            summary={proof ? `Comprovativo ${proofStatusText[proof.status].label.toLowerCase()}` : 'Ainda sem comprovativo'}
          >
            {proof ? <ProofDetails booking={booking} /> : <p className="text-base">A família ainda não enviou o comprovativo de pagamento.</p>}
          </AccordionSection>
        )}

        {canShare && (
          <AccordionSection title="Partilha de registos" icon={Share2} summary="O que a família partilhou consigo">
            <p className="text-base">Se a família partilhou o registo de saúde consigo para esta marcação, abre-o aqui, por tempo limitado.</p>
            <ButtonLink to={`${paths.professionalShares}?marcacao=${booking.id}`} variant="soft" size="lg" fullWidth>
              Ver partilhas desta marcação
            </ButtonLink>
          </AccordionSection>
        )}

        {/* Receita digital: só aparece com a receita digital ligada (canPrescribe/hasPrescription vêm omitidos senão). */}
        {hasPrescription && (
          <AccordionSection title="Receita" icon={FileText} summary={booking.hasPrescription ? 'Já emitida' : 'Ainda por emitir'}>
            <p className="text-base">{booking.hasPrescription ? 'A receita desta marcação já foi emitida.' : 'Pode emitir uma receita digital para esta consulta.'}</p>
            <ButtonLink to={paths.professionalPrescription(booking.id)} variant="soft" size="lg" fullWidth>
              {booking.hasPrescription ? 'Ver a receita emitida' : 'Emitir receita'}
            </ButtonLink>
          </AccordionSection>
        )}

        {booking.conversationId && (
          <AccordionSection title="Conversa" icon={MessageCircle} summary="Fale com a família">
            <ButtonLink to={paths.professionalConversation(booking.conversationId)} variant="soft" size="lg" fullWidth>
              Abrir a conversa
            </ButtonLink>
          </AccordionSection>
        )}
      </div>

      {action && (
        <ActionSheet
          action={action}
          needsInfo={needsInfo}
          busy={busy}
          onClose={() => setAction(null)}
          onSubmit={async (text) => {
            const task =
              action === 'confirm'
                ? () => professionalBookingService.confirm(booking.id, text)
                : action === 'reject'
                  ? () => professionalBookingService.reject(booking.id, text ?? '')
                  : action === 'cancel'
                    ? () => professionalBookingService.cancel(booking.id, text ?? '')
                    : () => professionalBookingService.decideProof(booking.id, proof?.id ?? '', { decision: 'REJECT', reason: text })
            setAction(null)
            await run(task, action === 'confirm' ? 'Marcação confirmada.' : action === 'reject' ? 'Pedido recusado.' : action === 'cancel' ? 'Marcação cancelada.' : 'Comprovativo recusado.')
          }}
        />
      )}

      <ConfirmSheet
        open={quick !== null}
        title={quick ? quickText[quick].title : ''}
        description={quick ? quickText[quick].text : undefined}
        yesLabel={quick ? quickText[quick].yes : 'Sim'}
        onYes={answerQuick}
        onNo={() => setQuick(null)}
      />
    </>
  )
}

/** «O que falta fazer»: o único passo a dar neste ecrã, com uma só ação principal. */
function NextStep({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="passo" className="flex flex-col gap-4 rounded-2xl border border-warning/30 bg-warning-soft p-5">
      <h2 id="passo" className="text-base font-semibold text-warning">
        O que falta fazer
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold">{title}</p>
        <p className="text-base">{text}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function ProofDetails({ booking }: { booking: ProfessionalBooking }) {
  const toast = useToast()
  const proof = booking.proof
  if (!proof) return null
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Comprovativo de pagamento</h3>
        <Badge tone={proofStatusText[proof.status].tone}>{proofStatusText[proof.status].label}</Badge>
      </div>
      <p className="text-base text-muted">
        {proofTypeLabel[proof.contentType]} · {formatFileSize(proof.sizeBytes)} · enviado {formatWhenLuanda(proof.createdAt)} · pagamento: {paymentStatusText[booking.paymentStatus].label.toLowerCase()}
      </p>
      {proof.scanStatus === 'PENDING' && <p className="text-base text-muted">O ficheiro ainda está a ser verificado.</p>}
      {proof.decisionReason && <p className="text-base">Motivo indicado: {proof.decisionReason}</p>}
      {proof.status === 'DISPUTED' && <p className="text-base">A família pediu a análise da Vita Family. Receberá a decisão por e-mail.</p>}
      <p className="text-sm text-muted">{PROFESSIONAL_PROOF_NOTICE}</p>
      {proof.scanStatus === 'CLEAN' && !proof.purged && (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          icon={<Download className="size-5" aria-hidden />}
          onClick={() =>
            void professionalBookingService
              .downloadProof(booking.id, proof.id)
              .then((blob) => saveBlob(blob, `comprovativo.${proofTypeLabel[proof.contentType].toLowerCase()}`))
              .catch((error: unknown) => toast.show(errorMessage(error), 'error'))
          }
        >
          Descarregar
        </Button>
      )}
    </>
  )
}

const ACTION_TEXT: Record<Action, { title: string; label: string; yes: string; required: boolean; max: number; hint: string }> = {
  confirm: { title: 'Confirmar esta marcação?', label: 'Ligação ou número a ligar', yes: 'Sim, confirmar', required: false, max: MEETING_INFO_MAX, hint: 'Só a família desta marcação vê esta informação.' },
  reject: { title: 'Recusar este pedido?', label: 'Motivo', yes: 'Sim, recusar', required: true, max: NOTE_MAX, hint: `A família vê este motivo. ${NO_HEALTH_DATA_HINT}` },
  cancel: { title: 'Cancelar esta marcação?', label: 'Motivo', yes: 'Sim, cancelar', required: true, max: NOTE_MAX, hint: `A família vê este motivo. ${NO_HEALTH_DATA_HINT}` },
  'reject-proof': { title: 'Recusar o comprovativo?', label: 'Motivo', yes: 'Sim, recusar', required: true, max: NOTE_MAX, hint: 'A família vê este motivo e pode pedir a análise da Vita Family.' },
}

/** Pergunta com «Sim»/«Não» e, quando é preciso, um campo de texto (ligação, motivo). */
function ActionSheet({ action, needsInfo, busy, onClose, onSubmit }: { action: Action; needsInfo: boolean; busy: boolean; onClose: () => void; onSubmit: (text?: string) => Promise<void> }) {
  const config = ACTION_TEXT[action]
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const required = action === 'confirm' ? needsInfo : config.required

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = plainText(text, config.max, { required })
    if (value === null) return setError(required ? 'Preencha este campo.' : 'O texto não é válido.')
    void onSubmit(value === '' ? undefined : value)
  }

  return (
    <Sheet open onClose={onClose} title={config.title}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {action === 'confirm' ? (
          <Input label={config.label} value={text} onChange={(event) => setText(event.target.value)} maxLength={config.max} hint={needsInfo ? `Obrigatório em vídeo e telefone. ${config.hint}` : `Opcional. ${config.hint}`} />
        ) : (
          <Textarea label={config.label} value={text} onChange={(event) => setText(event.target.value)} maxLength={config.max} hint={`${config.hint} ${text.length}/${config.max} caracteres`} />
        )}
        <FormError message={error} />
        <Button type="submit" size="xl" fullWidth variant={action === 'confirm' ? 'primary' : 'danger'} loading={busy}>
          {config.yes}
        </Button>
        <Button size="xl" variant="secondary" fullWidth onClick={onClose} disabled={busy}>
          Não
        </Button>
      </form>
    </Sheet>
  )
}
