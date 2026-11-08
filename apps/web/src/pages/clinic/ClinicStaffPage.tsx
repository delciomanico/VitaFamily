import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { clinicRole } from '@/lib/labels'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicAccount, ClinicProfessional } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface InviteFormProps {
  /** Profissionais ativos do catálogo (para o Médico). */
  professionals: ClinicProfessional[]
  /** Contas existentes: um profissional só tem uma conta Médico (BR-CLN-39). */
  staff: ClinicAccount[]
  onClose: () => void
  onCreated: (account: ClinicAccount) => void
}

type NewRole = 'CLINIC_MANAGER' | 'CLINIC_DOCTOR'

/** Criar uma conta de Receção (Gestor) ou de Médico da própria clínica (`POST /clinic-portal/staff`, BR-CLN-05/39). */
function InviteForm({ professionals, staff, onClose, onCreated }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<NewRole>('CLINIC_MANAGER')
  const [professionalId, setProfessionalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const taken = new Set(staff.filter((a) => a.role === 'CLINIC_DOCTOR').map((a) => a.professionalId))
  const available = professionals.filter((p) => p.active && !taken.has(p.id))

  async function create() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza um e-mail válido.')
    if (role === 'CLINIC_DOCTOR' && !professionalId) return setError('Escolha o profissional desta conta de Médico.')
    setSaving(true)
    try {
      onCreated(
        await clinicPortalService.createStaff({
          email,
          role,
          professionalId: role === 'CLINIC_DOCTOR' ? professionalId : undefined,
        }),
      )
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
      title="Nova conta da equipa"
      description="A palavra-passe inicial é enviada para este e-mail."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={create} loading={saving}>
            Criar conta
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="E-mail"
          type="email"
          placeholder="nome@clinica.pt"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setError(null)
          }}
        />
        <Select
          label="Papel"
          value={role}
          options={[
            { value: 'CLINIC_MANAGER', label: 'Receção (Gestor)' },
            { value: 'CLINIC_DOCTOR', label: 'Médico' },
          ]}
          onChange={(event) => {
            setRole(event.target.value as NewRole)
            setError(null)
          }}
        />
        {role === 'CLINIC_DOCTOR' && (
          <Select
            label="Profissional"
            value={professionalId}
            placeholder="Escolha o profissional"
            options={available.map((p) => ({ value: p.id, label: p.specialty ? `${p.name} · ${p.specialty}` : p.name }))}
            hint={available.length === 0 ? 'Todos os profissionais ativos já têm conta de Médico, ou ainda não há profissionais.' : undefined}
            onChange={(event) => {
              setProfessionalId(event.target.value)
              setError(null)
            }}
          />
        )}
        <p className="text-sm text-muted">
          {role === 'CLINIC_MANAGER'
            ? 'A receção pode responder a pedidos, gerir a agenda, emitir recibos e publicar horários desta clínica, mas não cria nem remove contas.'
            : 'O Médico vê só Hoje, a sua Agenda, os seus Pacientes e os seus Exames. Pode iniciar e concluir consultas e fazer recomendações, mas não vê o financeiro nem a equipa.'}
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/**
 * Contas do portal desta clínica (`/clinic-portal/staff`, BR-CLN-05): o Admin da clínica vê, cria
 * e remove os seus Gestores. A própria conta de Admin é criada e reposta apenas pela equipa da
 * plataforma (`POST /admin/clinics/{id}/root-account`), por isso não aparece nesta lista.
 */
export function ClinicStaffPage() {
  const { session } = useClinicAuth()
  const toast = useToast()
  const { state, reload } = useAsync(
    async () => ({
      staff: await clinicPortalService.listStaff(),
      professionals: await clinicCatalogService.listProfessionals({ active: true }),
    }),
    [],
  )
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<ClinicAccount | null>(null)
  const [busy, setBusy] = useState(false)

  const staff = state.status === 'success' ? state.data.staff : []
  const professionalName = (id?: string) =>
    state.status === 'success' ? state.data.professionals.find((p) => p.id === id)?.name : undefined

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await clinicPortalService.removeStaff(removing.id)
      toast.show('Conta removida.')
      setRemoving(null)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(false)
      reload()
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Contas da clínica</h1>
        <Button size="sm" onClick={() => setInviting(true)} icon={<UserPlus className="size-4" aria-hidden />}>
          Nova conta
        </Button>
      </div>

      <Card className="flex flex-col gap-1">
        <span className="text-sm font-semibold">A sua conta</span>
        <span className="text-sm text-muted">
          {session?.email ?? 'Conta em sessão'} · {session ? clinicRole[session.role] : ''}
        </span>
        <span className="text-sm text-muted">
          A conta de Admin da clínica é criada e reposta pela equipa Vita Family; a receção (Gestor) e os Médicos são geridos aqui.
        </span>
      </Card>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{formatCount(staff.length, 'conta', 'contas')}</h2>
          {staff.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {staff.map((account) => (
                <div key={account.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{account.email}</span>
                    <span className="block truncate text-sm text-muted">
                      {account.role === 'CLINIC_MANAGER' ? 'Receção (Gestor)' : clinicRole[account.role]}
                      {account.role === 'CLINIC_DOCTOR' && professionalName(account.professionalId)
                        ? ` · ${professionalName(account.professionalId)}`
                        : ''}
                    </span>
                  </span>
                  {account.status === 'SUSPENDED' && (
                    <Badge tone="danger" dot>
                      Suspensa
                    </Badge>
                  )}
                  <button
                    type="button"
                    onClick={() => setRemoving(account)}
                    aria-label={`Remover a conta ${account.email}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState
              icon={Users}
              title="Sem contas da equipa."
              description="Crie contas de receção para responder a pedidos e publicar horários, ou de Médico para cada profissional."
            />
          )}
        </section>
      )}

      {inviting && (
        <InviteForm
          professionals={state.status === 'success' ? state.data.professionals : []}
          staff={staff}
          onClose={() => setInviting(false)}
          onCreated={(account) => {
            setInviting(false)
            toast.show(`Conta de ${account.email} criada.`)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remover esta conta?"
        description={removing ? `${removing.email} deixa de ter acesso ao portal desta clínica.` : undefined}
        confirmLabel="Remover conta"
        destructive
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
