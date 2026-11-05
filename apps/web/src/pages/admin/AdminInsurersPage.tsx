import { useState } from 'react'
import { Landmark, KeyRound, Pause, Pencil, Play, Plus } from 'lucide-react'
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
import type { Insurer } from '@/types/insurance'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TAX_ID_PATTERN = /^\d{9}$/

/** `POST /admin/insurers` ou `PATCH /admin/insurers/{id}` (BR-ADM-05): criar ou editar uma seguradora. */
function InsurerForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Insurer
  onClose: () => void
  onSaved: (insurer: Insurer) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [taxId, setTaxId] = useState(initial?.taxId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return setError('Introduza o nome da seguradora.')
    if (!TAX_ID_PATTERN.test(taxId.trim())) return setError('O NIF tem 9 dígitos.')
    setSaving(true)
    try {
      const values = { name, taxId }
      onSaved(initial ? await adminService.updateInsurer(initial.id, values) : await adminService.createInsurer(values))
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
      title={initial ? 'Editar seguradora' : 'Nova seguradora'}
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
        <Input
          label="Nome"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        <Input
          label="NIF"
          inputMode="numeric"
          value={taxId}
          onChange={(event) => {
            setTaxId(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** `POST /admin/insurers/{id}/root-account`: única via de criar a conta Admin da seguradora. */
function RootAccountForm({
  insurer,
  onClose,
  onDone,
}: {
  insurer: Insurer
  onClose: () => void
  onDone: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza um e-mail válido.')
    setSaving(true)
    try {
      await adminService.createOrResetInsurerRootAccount(insurer.id, email)
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
      title="Criar ou repor a conta Admin da seguradora"
      description="A palavra-passe inicial (ou reposta) é enviada para este e-mail; nunca aparece aqui. Os agentes são criados pela própria seguradora."
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

const iconButton =
  'flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

/** Seguradoras (`/admin/insurers`, BR-ADM-05): criar, editar, suspender/reativar e gerir a conta raiz. */
export function AdminInsurersPage() {
  const toast = useToast()
  const { state, reload } = useAsync(() => adminService.listInsurers(), [])
  const [editing, setEditing] = useState<Insurer | 'new' | null>(null)
  const [rootAccountFor, setRootAccountFor] = useState<Insurer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const insurers = state.status === 'success' ? state.data : []

  async function toggleStatus(insurer: Insurer) {
    setBusyId(insurer.id)
    try {
      const next = insurer.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
      await adminService.setInsurerStatus(insurer.id, next)
      toast.show(next === 'SUSPENDED' ? `${insurer.name} suspensa.` : `${insurer.name} reativada.`)
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
        <h1 className="text-xl font-semibold">Seguradoras</h1>
        <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" aria-hidden />}>
          Nova seguradora
        </Button>
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">
            {formatCount(insurers.length, 'seguradora', 'seguradoras')}
          </h2>
          {insurers.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {insurers.map((insurer) => (
                <div key={insurer.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{insurer.name}</span>
                    <span className="block truncate text-sm text-muted">NIF {insurer.taxId}</span>
                  </span>
                  {insurer.status === 'SUSPENDED' && <Badge tone="neutral">Suspensa</Badge>}
                  <button
                    type="button"
                    onClick={() => setRootAccountFor(insurer)}
                    aria-label={`Criar ou repor a conta Admin de ${insurer.name}`}
                    className={iconButton}
                  >
                    <KeyRound className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(insurer)}
                    aria-label={`Editar ${insurer.name}`}
                    className={iconButton}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === insurer.id}
                    onClick={() => void toggleStatus(insurer)}
                    aria-label={insurer.status === 'ACTIVE' ? `Suspender ${insurer.name}` : `Reativar ${insurer.name}`}
                    className={iconButton}
                  >
                    {insurer.status === 'ACTIVE' ? (
                      <Pause className="size-4" aria-hidden />
                    ) : (
                      <Play className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState
              icon={Landmark}
              title="Sem seguradoras."
              description="Crie uma seguradora para depois lhe atribuir a conta Admin do portal."
            />
          )}
        </section>
      )}

      {editing && (
        <InsurerForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(insurer) => {
            setEditing(null)
            toast.show(editing === 'new' ? `${insurer.name} criada.` : `${insurer.name} atualizada.`)
            reload()
          }}
        />
      )}

      {rootAccountFor && (
        <RootAccountForm
          insurer={rootAccountFor}
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
