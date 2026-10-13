import { useEffect, useState } from 'react'
import { Lock, Unlock, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import type { AdminUser } from '@/types/admin'

const statusTone: Record<AdminUser['status'], { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  ACTIVE: { label: 'Ativa', tone: 'success' },
  PENDING_VERIFICATION: { label: 'Por verificar', tone: 'warning' },
  SUSPENDED: { label: 'Suspensa', tone: 'danger' },
}

interface SuspendFormProps {
  user: AdminUser
  onClose: () => void
  onSuspended: () => void
}

/** `POST /admin/users/{id}/suspend` (BR-ACC-05): exige motivo; revoga sessões. */
function SuspendForm({ user, onClose, onSuspended }: SuspendFormProps) {
  const { user: actor } = useAuth()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    if (!reason.trim()) return setError('Indique o motivo da suspensão.')
    setSaving(true)
    try {
      await adminService.suspendUser(user.id, reason, actor?.id ?? '')
      onSuspended()
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
      title="Suspender conta?"
      description={`${user.email} deixa de conseguir entrar; as sessões ativas são revogadas.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={confirm} loading={saving}>
            Suspender
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea
          label="Motivo"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Contas de utilizador (`/admin/users`, FR-ADM-01, R10): só o essencial, nunca dados de saúde. */
export function AdminUsersPage() {
  const { user: actor } = useAuth()
  const toast = useToast()
  const { state, reload } = useAsync(() => adminService.listUsers(), [])
  const [suspending, setSuspending] = useState<AdminUser | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [extraPages, setExtraPages] = useState<AdminUser[][]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Cada nova resposta da primeira página (carga inicial ou `reload()`) reinicia a paginação.
  useEffect(() => {
    if (state.status === 'success') {
      setExtraPages([])
      setNextCursor(state.data.nextCursor)
    }
  }, [state])

  const users = state.status === 'success' ? [...state.data.items, ...extraPages.flat()] : []

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await adminService.listUsers(nextCursor)
      setExtraPages((pages) => [...pages, page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  async function reactivate(user: AdminUser) {
    setReactivatingId(user.id)
    try {
      await adminService.reactivateUser(user.id)
      toast.show(`Conta de ${user.email} reativada.`)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setReactivatingId(null)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Contas</h1>

      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{formatCount(users.length, 'conta', 'contas')}</h2>
          {users.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {users.map((user) => (
                <div key={user.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{user.email}</span>
                    {user.id === actor?.id && <span className="block truncate text-sm text-muted">A sua conta</span>}
                  </span>
                  <Badge tone={statusTone[user.status].tone} dot>
                    {statusTone[user.status].label}
                  </Badge>
                  {user.status === 'SUSPENDED' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={reactivatingId === user.id}
                      onClick={() => void reactivate(user)}
                      icon={<Unlock className="size-4" aria-hidden />}
                    >
                      Reativar
                    </Button>
                  ) : (
                    <button
                      type="button"
                      disabled={user.id === actor?.id}
                      onClick={() => setSuspending(user)}
                      aria-label={`Suspender a conta ${user.email}`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Lock className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState icon={Users} title="Sem contas." />
          )}
          {nextCursor && (
            <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
              Carregar mais
            </Button>
          )}
        </section>
      )}

      {suspending && (
        <SuspendForm
          user={suspending}
          onClose={() => setSuspending(null)}
          onSuspended={() => {
            toast.show(`Conta de ${suspending.email} suspensa.`)
            setSuspending(null)
            reload()
          }}
        />
      )}
    </>
  )
}
