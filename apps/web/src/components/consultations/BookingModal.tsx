import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChoiceList } from '@/components/app/ChoiceList'
import { FilterChips } from '@/components/app/FilterChips'
import { Wizard } from '@/components/app/Wizard'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { ErrorState, FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { CANCELLATION_NOTICE, MARKET_TERMS_NOTICE, PARTICIPANT_LABEL_MAX, PAYMENT_OUTSIDE_APP_NOTICE, plainText } from '@/lib/consultations'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDateLuanda, formatTimeLuanda, luandaDayISO } from '@/lib/format'
import { categoryNotice } from '@/lib/marketplace'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { consultationService } from '@/services/consultation.service'
import { conversationService, type MessagingMember } from '@/services/conversation.service'
import { marketplaceService } from '@/services/marketplace.service'
import type { MarketplaceOffer } from '@/types/marketplace'
import type { Specialty } from '@/types/professional'

interface BookingModalProps {
  open: boolean
  onClose: () => void
  professional: { id: string; displayName: string }
  offers: MarketplaceOffer[]
  specialties: Specialty[]
  /** Oferta pré-escolhida (a da especialidade pesquisada). */
  initialOfferId?: string
}

/**
 * Marcar uma consulta em nome de um membro, passo a passo e em ecrã inteiro: para quem, serviço, horário
 * e confirmação com os avisos (UC-MKT-26/27). Sem motivo em texto livre (BR-MKT-51).
 */
export function BookingModal(props: BookingModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const { open, onClose, professional } = props

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={`Marcar com ${professional.displayName}`}
      className="app-mobile m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground"
    >
      {/* Montado só com o ecrã aberto: cada abertura começa com campos e pedido idempotente novos. */}
      {open && (
        <div className="mx-auto flex min-h-dvh max-w-[34rem] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <BookingForm {...props} />
        </div>
      )}
    </dialog>
  )
}

const DAYS_AHEAD = 56

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').slice(0, PARTICIPANT_LABEL_MAX)
}

type StepId = 'member' | 'offer' | 'slot' | 'confirm'

const STEP_TITLE: Record<StepId, string> = {
  member: 'Para quem é a consulta?',
  offer: 'Que serviço quer?',
  slot: 'Quando prefere?',
  confirm: 'Confirme o pedido',
}

function BookingForm({ onClose, professional, offers, specialties, initialOfferId }: BookingModalProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const members = useAsync(() => conversationService.eligibleMembers(familyId, userId), [familyId, userId])

  const requestIdRef = useRef(crypto.randomUUID())
  const [step, setStep] = useState(0)
  const [offerId, setOfferId] = useState(initialOfferId && offers.some((o) => o.id === initialOfferId) ? initialOfferId : (offers[0]?.id ?? ''))
  const [pickedMember, setPickedMember] = useState('')
  const [day, setDay] = useState('')
  const [slotId, setSlotId] = useState('')
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const offer = offers.find((o) => o.id === offerId)
  const specialty = specialties.find((s) => s.id === offer?.specialtyId)
  const eligible: MessagingMember[] = members.state.status === 'success' ? members.state.data : []
  const memberId = pickedMember || (eligible.length === 1 ? (eligible[0]?.id ?? '') : '')
  const member = eligible.find((m) => m.id === memberId)
  const label = labelDraft ?? firstName(member?.name ?? '')

  const slots = useAsync(
    () => (offerId ? marketplaceService.slots(professional.id, offerId, new Date().toISOString(), new Date(Date.now() + DAYS_AHEAD * 86_400_000).toISOString()) : Promise.resolve([])),
    [professional.id, offerId],
  )
  const slotList = useMemo(() => (slots.state.status === 'success' ? slots.state.data : []), [slots.state])
  const days = useMemo(() => [...new Set(slotList.map((s) => luandaDayISO(s.startsAt)))], [slotList])
  const activeDay = day && days.includes(day) ? day : (days[0] ?? '')
  const daySlots = slotList.filter((s) => luandaDayISO(s.startsAt) === activeDay)

  // Só há passo «para quem» se houver escolha, e «serviço» se houver mais de um.
  const steps: StepId[] = [...(eligible.length === 1 ? [] : (['member'] as const)), ...(offers.length > 1 ? (['offer'] as const) : []), 'slot', 'confirm']
  const current = steps[Math.min(step, steps.length - 1)] ?? 'slot'
  const text = plainText(label, PARTICIPANT_LABEL_MAX, { required: true })

  const nextDisabled =
    (current === 'member' && !member) || (current === 'slot' && !slotId) || (current === 'confirm' && (eligible.length === 0 || text === null || !accepted))

  async function next() {
    if (current !== 'confirm') {
      setStep(step + 1)
      return
    }
    if (sending || !member || text === null) return
    setFormError(null)
    setSending(true)
    try {
      const booking = await consultationService.create(familyId, userId, member.id, { offerId, slotId, participantLabel: text, clientRequestId: requestIdRef.current })
      toast.show('Pedido enviado. Fica a aguardar a resposta do profissional.')
      navigate(paths.booking(member.id, booking.id))
    } catch (error) {
      setFormError(errorMessage(error))
      if (isAppError(error, 'SLOT_UNAVAILABLE')) {
        // Perdeu-se a corrida pelo horário: mostra os que ficam livres.
        setSlotId('')
        slots.reload()
        setStep(steps.indexOf('slot'))
      }
      setSending(false)
    }
  }

  return (
    <Wizard
      title={`Marcar com ${professional.displayName}`}
      stepTitle={STEP_TITLE[current]}
      step={Math.min(step, steps.length - 1)}
      total={steps.length}
      onBack={() => (step === 0 ? onClose() : setStep(step - 1))}
      onNext={next}
      nextLabel={current === 'confirm' ? 'Pedir marcação' : 'Continuar'}
      nextDisabled={nextDisabled}
      busy={sending}
      error={formError}
    >
      {members.state.status === 'error' && <ErrorState message={errorMessage(members.state.error)} onRetry={members.reload} />}
      {members.state.status === 'success' && eligible.length === 0 && <FormError message="Não pode marcar em nome de ninguém desta família." />}

      {current === 'member' && (
        <ChoiceList legend="Para quem?" hideLegend options={eligible.map((m) => ({ value: m.id, label: m.isSelf ? `${m.name} (eu)` : m.name }))} value={memberId} onChange={setPickedMember} />
      )}

      {current === 'offer' && (
        <ChoiceList
          legend="Serviço"
          hideLegend
          options={offers.map((o) => ({
            value: o.id,
            label: specialties.find((s) => s.id === o.specialtyId)?.name ?? 'Serviço',
            hint: `${offerMethodLabel[o.method]} · ${o.durationMinutes} min · ${formatKz(o.priceKz)}`,
          }))}
          value={offerId}
          onChange={(id) => {
            setOfferId(id)
            setSlotId('')
            setDay('')
          }}
        />
      )}

      {current === 'slot' && (
        <>
          {offer && (
            <p className="text-lg">
              <span className="font-semibold">{formatKz(offer.priceKz)}</span> · {offerMethodLabel[offer.method]} · {offer.durationMinutes} min
            </p>
          )}
          {slots.state.status === 'loading' && (
            <p role="status" className="text-base text-muted">
              A carregar horários…
            </p>
          )}
          {slots.state.status === 'error' && <ErrorState message={errorMessage(slots.state.error)} onRetry={slots.reload} />}
          {slots.state.status === 'success' && days.length === 0 && <p className="text-base text-muted">Sem horários livres para este serviço nas próximas semanas.</p>}
          {days.length > 0 && (
            <>
              <FilterChips
                label="Dia"
                items={days.map((d) => ({ value: d, label: formatShortDateLuanda(`${d}T12:00:00+01:00`) }))}
                value={activeDay}
                onChange={(d) => {
                  setDay(d)
                  setSlotId('')
                }}
              />
              <div role="group" aria-label="Horários livres" className="grid grid-cols-3 gap-3">
                {daySlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={slotId === slot.id}
                    onClick={() => setSlotId(slot.id)}
                    className={cn(
                      'min-h-14 rounded-2xl border-2 px-3 text-lg font-semibold tabular-nums transition-colors',
                      slotId === slot.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-surface-muted',
                    )}
                  >
                    {formatTimeLuanda(slot.startsAt)}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {current === 'confirm' && (
        <>
          {specialty && (
            <p role="note" className="rounded-xl bg-warning-soft px-4 py-3 text-base">
              {categoryNotice[specialty.category]}
            </p>
          )}
          <dl className="flex flex-col gap-1 rounded-2xl bg-primary-soft p-4 text-lg">
            <dt className="sr-only">Resumo</dt>
            <dd className="font-semibold">{professional.displayName}</dd>
            {member && <dd>Para {member.name}</dd>}
            {slotId && <dd>{formatShortDateLuanda(`${activeDay}T12:00:00+01:00`)} às {formatTimeLuanda(slotList.find((s) => s.id === slotId)?.startsAt ?? '')}</dd>}
            {offer && <dd>{formatKz(offer.priceKz)}</dd>}
          </dl>
          <Input
            label="Como quer ser tratado/a"
            value={label}
            onChange={(event) => setLabelDraft(event.target.value)}
            maxLength={PARTICIPANT_LABEL_MAX}
            hint={`Até ${PARTICIPANT_LABEL_MAX} caracteres. É o nome que o profissional vê.`}
            error={text === null ? `Indique como quer ser tratado/a (até ${PARTICIPANT_LABEL_MAX} caracteres).` : undefined}
            autoComplete="off"
          />
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>{PAYMENT_OUTSIDE_APP_NOTICE}</p>
            <p>{CANCELLATION_NOTICE}</p>
            <p>{MARKET_TERMS_NOTICE}</p>
          </div>
          <Checkbox label="Li e aceito os termos" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        </>
      )}
    </Wizard>
  )
}
