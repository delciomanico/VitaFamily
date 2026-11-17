import { useState } from 'react'
import { Tags } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import { MAX_PRICE_KZ, OFFER_DURATIONS, type OfferMethod, type ProfessionalOffer, type Specialty } from '@/types/professional'

const MAX_NOTE_LENGTH = 200
const MAX_ACTIVE_OFFERS = 20
const METHODS = Object.keys(offerMethodLabel) as OfferMethod[]

/** Mensagens específicas das regras de oferta (BR-MKT-24/31); o resto vem de `errorMessage`. */
function offerErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Já tem uma oferta ativa com esta especialidade, método e duração.'
  if (isAppError(error, 'LIMIT_EXCEEDED')) return `Pode ter até ${MAX_ACTIVE_OFFERS} ofertas ativas. Desative uma para continuar.`
  return errorMessage(error)
}

/** Preço em Kwanza inteiro, sem cêntimos, entre 0 e o máximo (BR-MKT-24). */
function parsePrice(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value <= MAX_PRICE_KZ ? value : null
}

interface OfferFormProps {
  /** Ausente = criar; presente = editar preço e nota (BR-MKT-31: método, duração e especialidade são imutáveis). */
  offer?: ProfessionalOffer
  specialties: Specialty[]
  onClose: () => void
  onSaved: () => void
}

type FieldErrors = Partial<Record<'specialty' | 'method' | 'duration' | 'price', string>>

function OfferForm({ offer, specialties, onClose, onSaved }: OfferFormProps) {
  const [specialtyId, setSpecialtyId] = useState('')
  const [method, setMethod] = useState<OfferMethod | ''>('')
  const [duration, setDuration] = useState('')
  const [priceText, setPriceText] = useState(offer ? String(offer.priceKz) : '')
  const [note, setNote] = useState(offer?.note ?? '')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const noSpecialties = !offer && specialties.length === 0

  async function save() {
    const errors: FieldErrors = {}
    const durationValue = OFFER_DURATIONS.find((d) => String(d) === duration)
    const price = parsePrice(priceText)
    const noteTrimmed = note.trim()

    if (!offer) {
      if (!specialtyId) errors.specialty = 'Escolha a especialidade.'
      if (!method) errors.method = 'Escolha o método.'
      if (!durationValue) errors.duration = 'Escolha a duração.'
    }
    if (price === null) errors.price = `Indique um valor em Kwanza inteiro, entre 0 e ${formatKz(MAX_PRICE_KZ)}.`

    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0 || price === null) return

    setSaving(true)
    try {
      if (offer) {
        await professionalPortalService.updateOffer(offer.id, { priceKz: price, note: noteTrimmed || null })
      } else if (method && durationValue) {
        await professionalPortalService.createOffer({
          specialtyId,
          method,
          durationMinutes: durationValue,
          priceKz: price,
          note: noteTrimmed || null,
        })
      }
      onSaved()
    } catch (error) {
      setFormError(offerErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={offer ? 'Editar oferta' : 'Nova oferta'}
      description={offer ? undefined : 'Cada oferta é uma especialidade, um método e uma duração, com um preço.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button onClick={save} loading={saving} disabled={noSpecialties}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {offer ? (
          <>
            <p className="text-sm text-muted">
              {specialties.find((s) => s.id === offer.specialtyId)?.name ?? 'Especialidade'} · {offerMethodLabel[offer.method]} ·{' '}
              {offer.durationMinutes} min
            </p>
            <LockedNotice>
              Especialidade, método e duração não podem ser alterados. Para mudar o método ou a duração, crie outra oferta.
            </LockedNotice>
          </>
        ) : noSpecialties ? (
          <div className="flex flex-col gap-3 rounded-md bg-warning-soft px-3.5 py-3 text-sm text-warning">
            <p role="note">Ainda não tem especialidades. Escolha pelo menos uma no perfil para criar ofertas.</p>
            <ButtonLink to={paths.professionalProfile} variant="secondary" size="sm" className="self-start">
              Ir para o perfil
            </ButtonLink>
          </div>
        ) : (
          <>
            <Select
              label="Especialidade"
              placeholder="Escolha a especialidade"
              value={specialtyId}
              onChange={(event) => setSpecialtyId(event.target.value)}
              options={specialties.map((s) => ({ value: s.id, label: s.name }))}
              error={fieldErrors.specialty}
            />
            <Select
              label="Método"
              placeholder="Escolha o método"
              value={method}
              onChange={(event) => setMethod(event.target.value as OfferMethod | '')}
              options={METHODS.map((m) => ({ value: m, label: offerMethodLabel[m] }))}
              error={fieldErrors.method}
            />
            <Select
              label="Duração"
              placeholder="Escolha a duração"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              options={OFFER_DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))}
              error={fieldErrors.duration}
            />
          </>
        )}

        <Input
          label="Preço (Kz)"
          type="number"
          inputMode="numeric"
          step={1}
          min={0}
          max={MAX_PRICE_KZ}
          value={priceText}
          onChange={(event) => setPriceText(event.target.value)}
          hint="Kwanza inteiro, sem cêntimos. 0 = gratuito."
          error={fieldErrors.price}
          disabled={noSpecialties}
        />
        <Textarea
          label="Nota (opcional)"
          hint={`Até ${MAX_NOTE_LENGTH} caracteres, ex.: morada do atendimento presencial.`}
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={noSpecialties}
        />
        <FormError message={formError} />
      </div>
    </Modal>
  )
}

/** UC-MKT-08: serviços (ofertas) do profissional, com preço em Kz (BR-MKT-24/31). */
export function ProfessionalOffersPage() {
  usePageTitle('Serviços e preços')
  const toast = useToast()
  const profile = useProfessionalProfile()
  const offers = useAsync(() => professionalPortalService.listOffers(), [])
  const [formMode, setFormMode] = useState<'create' | ProfessionalOffer | null>(null)
  const [toDeactivate, setToDeactivate] = useState<ProfessionalOffer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const specialties = profile.profile?.specialties ?? []
  const specialtyName = (id: string) => specialties.find((s) => s.id === id)?.name ?? 'Especialidade'
  // Sem permissão comercial (REJECTED/SUSPENDED) ou perfil ainda a carregar: só leitura.
  const canEdit = profile.rights?.commercial === true

  function reloadAll() {
    offers.reload()
    profile.reload()
  }

  async function setActive(offer: ProfessionalOffer, active: boolean) {
    setBusyId(offer.id)
    try {
      await professionalPortalService.updateOffer(offer.id, { active })
      toast.show(active ? 'Oferta reativada.' : 'Oferta desativada.')
      offers.reload()
    } catch (error) {
      toast.show(offerErrorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  function onSaved() {
    setFormMode(null)
    toast.show('Oferta guardada.')
    offers.reload()
  }

  const loadError = offers.state.status === 'error' || profile.state.status === 'error'
  const loading = offers.state.status === 'loading' || profile.state.status === 'loading'
  const list = offers.state.status === 'success' ? [...offers.state.data].sort((a, b) => Number(b.active) - Number(a.active)) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Serviços e preços</h1>
        {canEdit && !loading && !loadError && (
          <Button size="sm" onClick={() => setFormMode('create')}>
            Nova oferta
          </Button>
        )}
      </div>

      {profile.rights?.readOnly && (
        <LockedNotice>Neste estado as ofertas estão em modo só de leitura. Não é possível criar, alterar nem ativar ou desativar.</LockedNotice>
      )}

      {loading && <LoadingState rows={3} />}
      {!loading && loadError && <ErrorState onRetry={reloadAll} />}

      {!loading &&
        !loadError &&
        (list.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="Ainda não tem ofertas"
            description={canEdit ? 'Crie a primeira oferta para os seus clientes poderem marcar atendimentos.' : undefined}
            action={
              canEdit && (
                <Button size="sm" onClick={() => setFormMode('create')}>
                  Nova oferta
                </Button>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((offer) => {
              const name = specialtyName(offer.specialtyId)
              const busy = busyId === offer.id
              return (
                <li key={offer.id}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="font-medium">{name}</p>
                        <p className="text-sm text-muted">
                          {offerMethodLabel[offer.method]} · {offer.durationMinutes} min
                        </p>
                      </div>
                      <Badge tone={offer.active ? 'success' : 'neutral'} dot>
                        {offer.active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </div>
                    <p className="text-lg font-semibold">{formatKz(offer.priceKz)}</p>
                    {offer.note && <p className="text-sm text-muted">{offer.note}</p>}
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setFormMode(offer)}
                          disabled={busy}
                          aria-label={`Editar preço e nota de ${name}`}
                        >
                          Editar
                        </Button>
                        {offer.active ? (
                          <Button
                            variant="danger-ghost"
                            size="sm"
                            onClick={() => setToDeactivate(offer)}
                            loading={busy}
                            aria-label={`Desativar oferta de ${name}`}
                          >
                            Desativar
                          </Button>
                        ) : (
                          <Button
                            variant="soft"
                            size="sm"
                            onClick={() => setActive(offer, true)}
                            loading={busy}
                            aria-label={`Reativar oferta de ${name}`}
                          >
                            Reativar
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        ))}

      {formMode !== null && (
        <OfferForm
          offer={formMode === 'create' ? undefined : formMode}
          specialties={specialties}
          onClose={() => setFormMode(null)}
          onSaved={onSaved}
        />
      )}

      <ConfirmDialog
        open={toDeactivate !== null}
        title="Desativar esta oferta?"
        description={
          toDeactivate
            ? `${specialtyName(toDeactivate.specialtyId)} · ${offerMethodLabel[toDeactivate.method]} · ${toDeactivate.durationMinutes} min. Os horários futuros ainda livres desta oferta serão removidos.`
            : undefined
        }
        confirmLabel="Desativar"
        destructive
        onCancel={() => setToDeactivate(null)}
        onConfirm={() => {
          const offer = toDeactivate
          setToDeactivate(null)
          if (offer) void setActive(offer, false)
        }}
      />
    </div>
  )
}
