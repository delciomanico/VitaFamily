import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { Plus, Tags } from 'lucide-react'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet, Sheet } from '@/components/app/Sheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { MAX_NOTE_LENGTH, offerErrorMessage, parsePrice } from '@/lib/offers'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import { MAX_PRICE_KZ, type ProfessionalOffer } from '@/types/professional'

/** Editar só o preço e a nota (BR-MKT-31: especialidade, método e duração são imutáveis), numa folha inferior. */
function EditSheet({ offer, name, onClose, onSaved }: { offer: ProfessionalOffer; name: string; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String(offer.priceKz))
  const [note, setNote] = useState(offer.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const value = parsePrice(price)
    if (value === null) return setError(`Escreva o preço em Kwanza, só com números, até ${formatKz(MAX_PRICE_KZ)}.`)
    setError(null)
    setSaving(true)
    try {
      await professionalPortalService.updateOffer(offer.id, { priceKz: value, note: note.trim() || null })
      onSaved()
    } catch (failure) {
      setError(offerErrorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title="Mudar preço e nota" description={`${name} · ${offerMethodLabel[offer.method]} · ${offer.durationMinutes} min`}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="flex flex-col gap-4"
      >
        <LockedNotice>A especialidade, o método e a duração não se podem mudar. Para isso, crie outro serviço.</LockedNotice>
        <Input label="Preço (Kz)" type="number" inputMode="numeric" step={1} min={0} max={MAX_PRICE_KZ} value={price} onChange={(event) => setPrice(event.target.value)} hint="Kwanza inteiro. 0 = gratuito." />
        <Textarea label="Nota (opcional)" rows={2} maxLength={MAX_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} />
        <FormError message={error} />
        <Button type="submit" size="xl" fullWidth loading={saving}>
          Guardar
        </Button>
        <Button size="xl" variant="secondary" fullWidth onClick={onClose} disabled={saving}>
          Não mudar
        </Button>
      </form>
    </Sheet>
  )
}

/** UC-MKT-08: serviços (ofertas) do profissional, com preço em Kz (BR-MKT-24/31). */
export function ProfessionalOffersPage() {
  usePageTitle('Os meus serviços')
  const toast = useToast()
  const profile = useProfessionalProfile()
  const offers = useAsync(() => professionalPortalService.listOffers(), [])
  const [editing, setEditing] = useState<ProfessionalOffer | null>(null)
  const [toDeactivate, setToDeactivate] = useState<ProfessionalOffer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const specialties = profile.profile?.specialties ?? []
  const specialtyName = (id: string) => specialties.find((s) => s.id === id)?.name ?? 'Especialidade'
  // Sem permissão comercial (REJECTED/SUSPENDED) ou perfil ainda a carregar: só leitura.
  const canEdit = profile.rights?.commercial === true

  async function setActive(offer: ProfessionalOffer, active: boolean) {
    setBusyId(offer.id)
    try {
      await professionalPortalService.updateOffer(offer.id, { active })
      toast.show(active ? 'Serviço reativado.' : 'Serviço desativado.')
      offers.reload()
    } catch (error) {
      toast.show(offerErrorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const loadError = offers.state.status === 'error' || profile.state.status === 'error'
  const loading = offers.state.status === 'loading' || profile.state.status === 'loading'
  const list = offers.state.status === 'success' ? [...offers.state.data].sort((a, b) => Number(b.active) - Number(a.active)) : []

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Os meus serviços" backTo={paths.professionalProfile} backLabel="Perfil" subtitle="O que oferece e quanto custa." />

      {profile.rights?.readOnly && <LockedNotice>Neste estado os serviços estão só para ler. Não é possível criar, mudar nem ativar ou desativar.</LockedNotice>}

      {canEdit && !loading && !loadError && list.length > 0 && (
        <ButtonLink to={paths.professionalOfferNew} size="xl" fullWidth icon={<Plus className="size-6" aria-hidden />}>
          Novo serviço
        </ButtonLink>
      )}

      {loading && <LoadingState rows={3} />}
      {!loading && loadError && <ErrorState onRetry={() => { offers.reload(); profile.reload() }} />}

      {!loading &&
        !loadError &&
        (list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
            <Tags className="size-10 text-muted" aria-hidden />
            <p className="text-lg font-semibold">Ainda não tem serviços</p>
            <p className="text-base text-muted">{canEdit ? 'Crie o primeiro para as famílias poderem marcar consigo.' : 'Quando puder, os seus serviços aparecem aqui.'}</p>
            {canEdit && (
              <ButtonLink to={paths.professionalOfferNew} size="xl" fullWidth>
                Criar o primeiro serviço
              </ButtonLink>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((offer) => {
              const name = specialtyName(offer.specialtyId)
              const busy = busyId === offer.id
              return (
                <li key={offer.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <p className="text-lg font-semibold">{name}</p>
                      <p className="text-base text-muted">
                        {offerMethodLabel[offer.method]} · {offer.durationMinutes} min
                      </p>
                    </div>
                    <Badge tone={offer.active ? 'success' : 'neutral'} dot>
                      {offer.active ? 'Ativo' : 'Desativado'}
                    </Badge>
                  </div>
                  <p className="text-2xl font-semibold">{formatKz(offer.priceKz)}</p>
                  {offer.note && <p className="text-base text-muted">{offer.note}</p>}
                  {canEdit && (
                    <div className="flex flex-col gap-2">
                      <Button variant="secondary" size="lg" fullWidth onClick={() => setEditing(offer)} disabled={busy} aria-label={`Mudar preço e nota de ${name}`}>
                        Mudar preço
                      </Button>
                      {offer.active ? (
                        <Button variant="danger-ghost" size="lg" fullWidth onClick={() => setToDeactivate(offer)} loading={busy} aria-label={`Desativar serviço de ${name}`}>
                          Desativar
                        </Button>
                      ) : (
                        <Button variant="soft" size="lg" fullWidth onClick={() => void setActive(offer, true)} loading={busy} aria-label={`Reativar serviço de ${name}`}>
                          Reativar
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      {editing && (
        <EditSheet
          offer={editing}
          name={specialtyName(editing.specialtyId)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toast.show('Serviço guardado.')
            offers.reload()
          }}
        />
      )}

      <ConfirmSheet
        open={toDeactivate !== null}
        title="Desativar este serviço?"
        description={
          toDeactivate
            ? `${specialtyName(toDeactivate.specialtyId)} · ${offerMethodLabel[toDeactivate.method]} · ${toDeactivate.durationMinutes} min. Os horários livres deste serviço serão retirados.`
            : undefined
        }
        yesLabel="Sim, desativar"
        destructive
        onNo={() => setToDeactivate(null)}
        onYes={() => {
          const offer = toDeactivate
          setToDeactivate(null)
          if (offer) void setActive(offer, false)
        }}
      />
      <Outlet context={{ onSaved: offers.reload }} />
    </div>
  )
}
