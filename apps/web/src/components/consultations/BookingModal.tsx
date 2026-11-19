import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select, type SelectOption } from '@/components/ui/Select'
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

/** Marcar uma consulta em nome de um membro: horário livre, rótulo, preço e avisos (UC-MKT-26/27). Sem motivo em texto livre (BR-MKT-51). */
export function BookingModal(props: BookingModalProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={`Marcar com ${props.professional.displayName}`}>
      {/* Montado só com o modal aberto: cada abertura começa com campos e pedido idempotente novos. */}
      {props.open && <BookingForm {...props} />}
    </Modal>
  )
}

const DAYS_AHEAD = 56

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').slice(0, PARTICIPANT_LABEL_MAX)
}

interface Errors {
  member?: string
  slot?: string
  label?: string
  terms?: string
}

function BookingForm({ onClose, professional, offers, specialties, initialOfferId }: BookingModalProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const members = useAsync(() => conversationService.eligibleMembers(familyId, userId), [familyId, userId])

  const requestIdRef = useRef(crypto.randomUUID())
  const [offerId, setOfferId] = useState(initialOfferId && offers.some((o) => o.id === initialOfferId) ? initialOfferId : (offers[0]?.id ?? ''))
  const [pickedMember, setPickedMember] = useState('')
  const [day, setDay] = useState('')
  const [slotId, setSlotId] = useState('')
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
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

  const offerOptions: SelectOption[] = offers.map((o) => ({
    value: o.id,
    label: `${specialties.find((s) => s.id === o.specialtyId)?.name ?? 'Serviço'} · ${offerMethodLabel[o.method]} · ${o.durationMinutes} min · ${formatKz(o.priceKz)}`,
  }))
  const memberOptions: SelectOption[] = eligible.map((m) => ({ value: m.id, label: m.isSelf ? `${m.name} (eu)` : m.name }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const text = plainText(label, PARTICIPANT_LABEL_MAX, { required: true })
    const next: Errors = {}
    if (!member) next.member = 'Escolha para quem é a consulta.'
    if (!slotId) next.slot = 'Escolha um horário.'
    if (text === null) next.label = `Indique como quer ser tratado/a (até ${PARTICIPANT_LABEL_MAX} caracteres).`
    if (!accepted) next.terms = 'Aceite os termos para marcar.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0 || !member || text === null) return

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
      }
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      {specialty && (
        <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
          {categoryNotice[specialty.category]}
        </p>
      )}

      {members.state.status === 'error' && <ErrorState message={errorMessage(members.state.error)} onRetry={members.reload} />}
      {members.state.status === 'success' && eligible.length === 0 && <FormError message="Não pode marcar em nome de ninguém desta família." />}

      <Select
        label="Para quem?"
        options={memberOptions}
        placeholder={eligible.length > 1 ? 'Escolha uma pessoa' : undefined}
        value={memberId}
        onChange={(event) => setPickedMember(event.target.value)}
        error={errors.member}
      />

      {offers.length > 1 && (
        <Select
          label="Serviço"
          options={offerOptions}
          value={offerId}
          onChange={(event) => {
            setOfferId(event.target.value)
            setSlotId('')
            setDay('')
          }}
        />
      )}

      {offer && (
        <p className="text-sm">
          <span className="text-muted">Preço: </span>
          <span className="font-semibold">{formatKz(offer.priceKz)}</span> · {offerMethodLabel[offer.method]} · {offer.durationMinutes} min
        </p>
      )}

      <div className="flex flex-col gap-2">
        {slots.state.status === 'loading' && (
          <p role="status" className="text-sm text-muted">
            A carregar horários…
          </p>
        )}
        {slots.state.status === 'error' && <ErrorState message={errorMessage(slots.state.error)} onRetry={slots.reload} />}
        {slots.state.status === 'success' && days.length === 0 && <p className="text-sm text-muted">Sem horários livres para este serviço nas próximas semanas.</p>}
        {days.length > 0 && (
          <>
            <Select
              label="Dia"
              options={days.map((d) => ({ value: d, label: formatShortDateLuanda(`${d}T12:00:00+01:00`) }))}
              value={activeDay}
              onChange={(event) => {
                setDay(event.target.value)
                setSlotId('')
              }}
            />
            <div role="group" aria-label="Horários livres" className="flex flex-wrap gap-2">
              {daySlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  aria-pressed={slotId === slot.id}
                  onClick={() => setSlotId(slot.id)}
                  className={cn(
                    'h-10 rounded-md border px-3 text-sm font-medium transition-colors',
                    slotId === slot.id ? 'border-primary bg-primary text-white' : 'border-border bg-surface hover:bg-surface-muted',
                  )}
                >
                  {formatTimeLuanda(slot.startsAt)}
                </button>
              ))}
            </div>
            {errors.slot && (
              <p role="alert" className="text-sm text-danger">
                {errors.slot}
              </p>
            )}
          </>
        )}
      </div>

      <Input
        label="Como quer ser tratado/a"
        value={label}
        onChange={(event) => setLabelDraft(event.target.value)}
        maxLength={PARTICIPANT_LABEL_MAX}
        hint={`Até ${PARTICIPANT_LABEL_MAX} caracteres. É o nome que o profissional vê.`}
        error={errors.label}
        autoComplete="off"
      />

      <div className="flex flex-col gap-1.5 text-xs text-muted">
        <p>{PAYMENT_OUTSIDE_APP_NOTICE}</p>
        <p>{CANCELLATION_NOTICE}</p>
        <p>{MARKET_TERMS_NOTICE}</p>
      </div>
      <Checkbox label="Li e aceito os termos" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} error={errors.terms} />

      <FormError message={formError} />

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={sending} disabled={eligible.length === 0}>
          Marcar
        </Button>
      </div>
    </form>
  )
}
