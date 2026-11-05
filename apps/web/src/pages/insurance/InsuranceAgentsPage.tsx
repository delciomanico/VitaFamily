import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { insurancePortalService } from '@/services/insurancePortal.service'
import { insuranceRole, type InsuranceAccount } from '@/types/insurance'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface InviteFormProps {
  onClose: () => void
  onCreated: (account: InsuranceAccount) => void
}

/** Criar uma conta de Agente da própria seguradora (`POST /insurance-portal/agents`, BR-INS-06). */
function InviteForm({ onClose, onCreated }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza um e-mail válido.')
    setSaving(true)
    try {
      onCreated(await insurancePortalService.createAgent(email))
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
      title="Nova conta de Agente"
      description="A conta é criada como Agente da seguradora e a palavra-passe inicial é enviada para este e-mail."
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
          placeholder="nome@seguradora.pt"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setError(null)
          }}
        />
        <p className="text-sm text-muted">
          Um Agente pode ver e decidir pedidos de reembolso desta seguradora, mas não cria nem remove contas.
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/**
 * Contas do portal desta seguradora (`/insurance-portal/agents`, BR-INS-06): o Admin da seguradora vê, cria
 * e remove os seus Agentes. A própria conta de Admin é criada e reposta apenas pela equipa da
 * plataforma (`POST /admin/insurers/{id}/root-account`), por isso não aparece nesta lista.
 */
export function InsuranceAgentsPage() {
  const { session } = useInsuranceAuth()
  const toast = useToast()
  const { state, reload } = useAsync(() => insurancePortalService.listAgents(), [])
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<InsuranceAccount | null>(null)
  const [busy, setBusy] = useState(false)

  const agents = state.status === 'success' ? state.data : []

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await insurancePortalService.removeAgent(removing.id)
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
        <h1 className="text-xl font-semibold">Contas da seguradora</h1>
        <Button size="sm" onClick={() => setInviting(true)} icon={<UserPlus className="size-4" aria-hidden />}>
          Novo Agente
        </Button>
      </div>

      <Card className="flex flex-col gap-1">
        <span className="text-sm font-semibold">A sua conta</span>
        <span className="text-sm text-muted">
          {session?.email ?? 'Conta em sessão'} · {session ? insuranceRole[session.role] : ''}
        </span>
        <span className="text-sm text-muted">
          A conta de Admin da seguradora é criada e reposta pela equipa Vita Family; os Agentes são geridos aqui.
        </span>
      </Card>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{formatCount(agents.length, 'Agente', 'Agentes')}</h2>
          {agents.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {agents.map((account) => (
                <div key={account.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{account.email}</span>
                    <span className="block truncate text-sm text-muted">{insuranceRole[account.role]}</span>
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
              title="Sem Agentes nesta seguradora."
              description="Crie contas de Agente para a equipa decidir pedidos de reembolso."
            />
          )}
        </section>
      )}

      {inviting && (
        <InviteForm
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
        description={removing ? `${removing.email} deixa de ter acesso ao portal desta seguradora.` : undefined}
        confirmLabel="Remover conta"
        destructive
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
