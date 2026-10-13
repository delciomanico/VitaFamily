import { useState } from 'react'
import { Archive, ArchiveRestore, Building2, KeyRound, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import type { ClinicInput } from '@/types/admin'
import type { Clinic } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ClinicFormProps {
  initial?: Clinic
  onClose: () => void
  onSaved: (clinic: Clinic) => void
}

/** `POST /admin/clinics` ou `PATCH /admin/clinics/{id}` (R8): criar ou editar uma clínica parceira. */
function ClinicForm({ initial, onClose, onSaved }: ClinicFormProps) {
  const [values, setValues] = useState<ClinicInput>({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof ClinicInput>(key: K, value: ClinicInput[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setError(null)
  }

  async function save() {
    if (!values.name.trim()) return setError('Introduza o nome da clínica.')
    setSaving(true)
    try {
      const saved = initial
        ? await adminService.updateClinic(initial.id, values)
        : await adminService.createClinic(values)
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
      title={initial ? 'Editar clínica' : 'Nova clínica parceira'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Nome" value={values.name} onChange={(event) => set('name', event.target.value)} />
        <Input label="Endereço" value={values.address} onChange={(event) => set('address', event.target.value)} />
        <Input label="Telefone" value={values.phone} onChange={(event) => set('phone', event.target.value)} />
        <Input
          label="E-mail"
          type="email"
          value={values.email}
          onChange={(event) => set('email', event.target.value)}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

interface RootAccountFormProps {
  clinic: Clinic
  onClose: () => void
  onDone: (email: string) => void
}

/** `POST /admin/clinics/{id}/root-account` (D18/BR-CLN-05): única via do Admin da plataforma. */
function RootAccountForm({ clinic, onClose, onDone }: RootAccountFormProps) {
  const [email, setEmail] = useState(clinic.email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza um e-mail válido.')
    setSaving(true)
    try {
      await adminService.createOrResetClinicRootAccount(clinic.id, email)
      onDone(email.trim())
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
      title="Criar ou repor a conta Admin da clínica"
      description="A palavra-passe inicial (ou reposta) é enviada para este e-mail; nunca aparece aqui. Esta é a única conta do portal criada pela plataforma — os Gestores são criados pela própria clínica."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={confirm} loading={saving}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="E-mail da conta Admin"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Clínicas parceiras (`/admin/clinics`, R8): criar, editar, arquivar/reativar e geri a conta raiz. */
export function AdminClinicsPage() {
  const toast = useToast()
  const { state, reload } = useAsync(() => adminService.listClinics(), [])
  const [editing, setEditing] = useState<Clinic | 'new' | null>(null)
  const [rootAccountFor, setRootAccountFor] = useState<Clinic | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const clinics = state.status === 'success' ? state.data : []

  async function toggleStatus(clinic: Clinic) {
    setBusyId(clinic.id)
    try {
      const next = clinic.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE'
      await adminService.setClinicStatus(clinic.id, next)
      toast.show(next === 'ARCHIVED' ? `${clinic.name} arquivada.` : `${clinic.name} reativada.`)
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
        <h1 className="text-xl font-semibold">Clínicas parceiras</h1>
        <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" aria-hidden />}>
          Nova clínica
        </Button>
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{formatCount(clinics.length, 'clínica', 'clínicas')}</h2>
          {clinics.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {clinics.map((clinic) => (
                <div key={clinic.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{clinic.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {clinic.type === 'PARTNER' ? 'Parceira' : 'Privada da família'}
                      {clinic.email ? ` · ${clinic.email}` : ''}
                    </span>
                  </span>
                  {clinic.status === 'ARCHIVED' && <Badge tone="neutral">Arquivada</Badge>}
                  {clinic.type === 'PARTNER' && (
                    <button
                      type="button"
                      onClick={() => setRootAccountFor(clinic)}
                      aria-label={`Criar ou repor a conta Admin de ${clinic.name}`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-primary-soft hover:text-primary"
                    >
                      <KeyRound className="size-4" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(clinic)}
                    aria-label={`Editar ${clinic.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === clinic.id}
                    onClick={() => void toggleStatus(clinic)}
                    aria-label={clinic.status === 'ACTIVE' ? `Arquivar ${clinic.name}` : `Reativar ${clinic.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    {clinic.status === 'ACTIVE' ? (
                      <Archive className="size-4" aria-hidden />
                    ) : (
                      <ArchiveRestore className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState
              icon={Building2}
              title="Sem clínicas parceiras."
              description="Crie uma clínica para depois lhe atribuir a conta Admin do portal."
            />
          )}
        </section>
      )}

      {editing && (
        <ClinicForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(clinic) => {
            setEditing(null)
            toast.show(editing === 'new' ? `${clinic.name} criada.` : `${clinic.name} atualizada.`)
            reload()
          }}
        />
      )}

      {rootAccountFor && (
        <RootAccountForm
          clinic={rootAccountFor}
          onClose={() => setRootAccountFor(null)}
          onDone={(email) => {
            setRootAccountFor(null)
            toast.show(`Credenciais enviadas para ${email}.`)
          }}
        />
      )}
    </>
  )
}
