import { useState } from 'react'
import { ClipboardList, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { SLOT_DURATIONS, type ClinicServiceType, type SlotKind } from '@/types/clinic'
import { formatPrice, parsePriceInput, priceToInput } from './format'

const KIND_OPTIONS = [
  { value: 'APPOINTMENT', label: 'Consulta' },
  { value: 'EXAM', label: 'Exame' },
]

interface FormProps {
  service: ClinicServiceType | null
  onClose: () => void
  onSaved: () => void
}

function ServiceForm({ service, onClose, onSaved }: FormProps) {
  const [name, setName] = useState(service?.name ?? '')
  const [kind, setKind] = useState<SlotKind>(service?.kind ?? 'APPOINTMENT')
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30))
  const [price, setPrice] = useState(priceToInput(service?.priceMinor))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const currency = service?.currency ?? 'AOA'

  async function save() {
    if (!name.trim()) return setError('Indique o nome do serviço.')
    const priceMinor = parsePriceInput(price)
    if (priceMinor === null) return setError('Indique o preço só com números, por exemplo 15000 ou 15000,50.')
    setSaving(true)
    try {
      if (service) {
        await clinicCatalogService.updateService(service.id, {
          name,
          durationMinutes: Number(duration),
          priceMinor: priceMinor ?? null,
        })
      } else {
        await clinicCatalogService.createService({ name, kind, durationMinutes: Number(duration), priceMinor })
      }
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={service ? 'Editar serviço' : 'Novo serviço'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Nome" placeholder="Ex.: Consulta de cardiologia" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setError(null) }} />
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Tipo"
            options={KIND_OPTIONS}
            value={kind}
            disabled={service !== null}
            onChange={(e) => setKind(e.target.value as SlotKind)}
            hint={service ? 'O tipo não se pode mudar.' : undefined}
          />
          <Select
            label="Duração"
            options={SLOT_DURATIONS.map((m) => ({ value: String(m), label: `${m} min` }))}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <Input
          label={`Preço em ${currency} (opcional)`}
          inputMode="decimal"
          placeholder="Ex.: 15000"
          value={price}
          onChange={(e) => { setPrice(e.target.value); setError(null) }}
          hint="Serve só de informação; não gera cobrança."
        />
        {service && (
          <p className="text-sm text-muted">Mudar a duração só afeta os horários que forem gerados daqui em diante.</p>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Serviços da clínica (BR-CLN-11/12): consultas e exames com duração e preço. */
export function ServicesTab() {
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicCatalogService.listServices(), [])
  const [editing, setEditing] = useState<ClinicServiceType | 'new' | null>(null)
  const [deactivating, setDeactivating] = useState<ClinicServiceType | null>(null)
  const [busy, setBusy] = useState(false)

  async function setActive(service: ClinicServiceType, active: boolean) {
    setBusy(true)
    try {
      await clinicCatalogService.updateService(service.id, { active })
      toast.show(active ? 'Serviço reativado.' : 'Serviço desativado.')
      setDeactivating(null)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(false)
      reload()
    }
  }

  const newButton = (
    <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" aria-hidden />}>
      Novo serviço
    </Button>
  )

  return (
    <section className="flex flex-col gap-3">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (state.data.length > 0 ? (
          <>
            <div className="flex justify-end">{newButton}</div>
            <Card className="divide-y divide-border py-1">
              {state.data.map((service) => (
                <div key={service.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{service.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {service.kind === 'EXAM' ? 'Exame' : 'Consulta'} · {service.durationMinutes} min ·{' '}
                      {formatPrice(service.priceMinor, service.currency)}
                    </span>
                  </span>
                  {!service.active && <Badge tone="neutral">Inativo</Badge>}
                  <button
                    type="button"
                    onClick={() => setEditing(service)}
                    aria-label={`Editar ${service.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-border"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  {service.active ? (
                    <Button size="sm" variant="danger-ghost" onClick={() => setDeactivating(service)}>
                      Desativar
                    </Button>
                  ) : (
                    <Button size="sm" variant="soft" onClick={() => void setActive(service, true)} disabled={busy}>
                      Reativar
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Ainda não tem serviços."
            description="Crie as consultas e os exames que a clínica faz, com a duração e o preço."
            action={newButton}
          />
        ))}

      {editing && (
        <ServiceForm
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.show(editing === 'new' ? 'Serviço criado.' : 'Serviço atualizado.')
            setEditing(null)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={deactivating !== null}
        title="Desativar este serviço?"
        description={
          deactivating
            ? `${deactivating.name} deixa de entrar em horários novos. Os horários livres gerados automaticamente são removidos; as marcações existentes mantêm-se.`
            : undefined
        }
        confirmLabel="Desativar"
        destructive
        loading={busy}
        onConfirm={() => deactivating && void setActive(deactivating, false)}
        onCancel={() => setDeactivating(null)}
      />
    </section>
  )
}
