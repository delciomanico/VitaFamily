import { useState } from 'react'
import { Pencil, Plus, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import type { ClinicProfessional } from '@/types/clinic'

interface FormProps {
  professional: ClinicProfessional | null
  onClose: () => void
  onSaved: () => void
}

function ProfessionalForm({ professional, onClose, onSaved }: FormProps) {
  const [name, setName] = useState(professional?.name ?? '')
  const [specialty, setSpecialty] = useState(professional?.specialty ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return setError('Indique o nome do profissional.')
    if (name.trim().length > 120 || specialty.trim().length > 80) return setError('O nome ou a especialidade são demasiado longos.')
    setSaving(true)
    try {
      if (professional) {
        await clinicCatalogService.updateProfessional(professional.id, { name, specialty: specialty.trim() || null })
      } else {
        await clinicCatalogService.createProfessional({ name, specialty })
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
      title={professional ? 'Editar profissional' : 'Novo profissional'}
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
        <Input label="Nome" placeholder="Ex.: Dr.ª Ana Costa" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setError(null) }} />
        <Input label="Especialidade (opcional)" placeholder="Ex.: Cardiologia" value={specialty} maxLength={80} onChange={(e) => setSpecialty(e.target.value)} />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Profissionais da clínica (BR-CLN-11): não se apagam, desativam-se. */
export function ProfessionalsTab() {
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicCatalogService.listProfessionals(), [])
  const [editing, setEditing] = useState<ClinicProfessional | 'new' | null>(null)
  const [deactivating, setDeactivating] = useState<ClinicProfessional | null>(null)
  const [busy, setBusy] = useState(false)

  async function setActive(professional: ClinicProfessional, active: boolean) {
    setBusy(true)
    try {
      await clinicCatalogService.updateProfessional(professional.id, { active })
      toast.show(active ? 'Profissional reativado.' : 'Profissional desativado.')
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
      Novo profissional
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
              {state.data.map((professional) => (
                <div key={professional.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <UserRound className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{professional.name}</span>
                    <span className="block truncate text-sm text-muted">{professional.specialty ?? 'Sem especialidade indicada'}</span>
                  </span>
                  {!professional.active && <Badge tone="neutral">Inativo</Badge>}
                  <button
                    type="button"
                    onClick={() => setEditing(professional)}
                    aria-label={`Editar ${professional.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-border"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  {professional.active ? (
                    <Button size="sm" variant="danger-ghost" onClick={() => setDeactivating(professional)}>
                      Desativar
                    </Button>
                  ) : (
                    <Button size="sm" variant="soft" onClick={() => void setActive(professional, true)} disabled={busy}>
                      Reativar
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </>
        ) : (
          <EmptyState
            icon={UserRound}
            title="Ainda não tem profissionais."
            description="Adicione os médicos e técnicos da clínica para lhes associar horários."
            action={newButton}
          />
        ))}

      {editing && (
        <ProfessionalForm
          professional={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.show(editing === 'new' ? 'Profissional adicionado.' : 'Profissional atualizado.')
            setEditing(null)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={deactivating !== null}
        title="Desativar este profissional?"
        description={
          deactivating
            ? `${deactivating.name} deixa de receber novos horários. Os horários livres gerados automaticamente são removidos; as marcações existentes mantêm-se.`
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
