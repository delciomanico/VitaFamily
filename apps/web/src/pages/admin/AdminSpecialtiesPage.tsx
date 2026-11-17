import { useState } from 'react'
import { Plus, Tags } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { categoryLabel } from '@/lib/professional'
import { professionalAdminService } from '@/services/professionalAdmin.service'
import type { AdminSpecialty, SpecialtyCategory } from '@/types/professional'

const CATEGORY_OPTIONS: SelectOption[] = (Object.keys(categoryLabel) as SpecialtyCategory[]).map((value) => ({
  value,
  label: categoryLabel[value],
}))

const NAME_MIN_LENGTH = 2
const NAME_MAX_LENGTH = 80

interface SpecialtyFormProps {
  initial?: AdminSpecialty
  onClose: () => void
  onSaved: (specialty: AdminSpecialty) => void
}

/** Criar ou editar uma especialidade do catálogo (sem remoção: só ativar/desativar). */
function SpecialtyForm({ initial, onClose, onSaved }: SpecialtyFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<SpecialtyCategory>(initial?.category ?? 'HEALTH')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // BR: a categoria só muda enquanto nenhum profissional a usar a especialidade.
  const categoryEditable = !initial || initial.professionalCount === 0

  async function save() {
    const trimmed = name.trim()
    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      setError(`Indique um nome entre ${NAME_MIN_LENGTH} e ${NAME_MAX_LENGTH} caracteres.`)
      return
    }
    setSaving(true)
    try {
      const saved = initial
        ? await professionalAdminService.updateSpecialty(initial.id, categoryEditable ? { name: trimmed, category } : { name: trimmed })
        : await professionalAdminService.createSpecialty({ name: trimmed, category })
      onSaved(saved)
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
      title={initial ? 'Editar especialidade' : 'Nova especialidade'}
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
        <Input
          label="Nome"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        {categoryEditable ? (
          <Select
            label="Categoria"
            options={CATEGORY_OPTIONS}
            value={category}
            hint="Fica bloqueada assim que houver profissionais a usá-la."
            onChange={(event) => setCategory(event.target.value as SpecialtyCategory)}
          />
        ) : (
          <p className="text-sm text-muted">
            Categoria: {categoryLabel[initial.category]}. A categoria fica bloqueada enquanto houver profissionais a usá-la.
          </p>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Catálogo de especialidades (`/admin/specialties`, UC-MKT-10). */
export function AdminSpecialtiesPage() {
  const toast = useToast()
  const { state, reload } = useAsync(() => professionalAdminService.listSpecialties(), [])
  const [editing, setEditing] = useState<AdminSpecialty | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggleActive(specialty: AdminSpecialty) {
    setBusyId(specialty.id)
    try {
      await professionalAdminService.updateSpecialty(specialty.id, { active: !specialty.active })
      toast.show(specialty.active ? `${specialty.name} desativada.` : `${specialty.name} reativada.`)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Especialidades</h1>
        <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" aria-hidden />}>
          Nova especialidade
        </Button>
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      {state.status === 'success' &&
        (state.data.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {state.data.map((specialty) => (
              <div key={specialty.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{specialty.name}</span>
                  <span className="block truncate text-sm text-muted">
                    {categoryLabel[specialty.category]} · {formatCount(specialty.professionalCount, 'profissional', 'profissionais')}
                  </span>
                </span>
                <Badge tone={specialty.active ? 'success' : 'neutral'} dot>
                  {specialty.active ? 'Ativa' : 'Inativa'}
                </Badge>
                <Button variant="secondary" size="sm" onClick={() => setEditing(specialty)}>
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === specialty.id}
                  onClick={() => void toggleActive(specialty)}
                >
                  {specialty.active ? 'Desativar' : 'Reativar'}
                </Button>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState icon={Tags} title="Sem especialidades." description="Crie a primeira especialidade do catálogo." />
        ))}

      {editing && (
        <SpecialtyForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(specialty) => {
            setEditing(null)
            toast.show(editing === 'new' ? `${specialty.name} criada.` : `${specialty.name} atualizada.`)
            reload()
          }}
        />
      )}
    </>
  )
}
