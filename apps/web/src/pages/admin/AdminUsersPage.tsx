import { useEffect, useState } from 'react'
import { Info, Lock, Search, Unlock, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatShortDate, formatWhen } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import { ADMIN_SEARCH_MIN, type AdminUser, type AdminUserDetail } from '@/types/admin'

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

/** `GET /admin/users/{id}` + `POST …/reset-access`: detalhe operacional, sem dados de saúde (R10). */
function UserDetailModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { user: actor } = useAuth()
  const toast = useToast()
  const { state, reload } = useAsync(() => adminService.getUser(user.id), [user.id])
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function reset() {
    setResetting(true)
    try {
      await adminService.resetUserAccess(user.id, actor?.id ?? '')
      toast.show(`Acesso reposto: enviámos um e-mail a ${user.email}.`)
      setConfirming(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setResetting(false)
    }
  }

  const rows = (d: AdminUserDetail): [string, string][] => [
    ['Nome', d.name],
    ['Estado', statusTone[d.status].label],
    ['Criada em', formatShortDate(d.createdAt)],
    ['E-mail verificado', d.emailVerifiedAt ? formatShortDate(d.emailVerifiedAt) : 'Não'],
    ['Famílias', String(d.familiesCount)],
    ['Sessões ativas', String(d.activeSessionsCount)],
    ['Última atividade', d.lastSessionUsedAt ? formatWhen(d.lastSessionUsedAt) : '—'],
    ...(d.suspendedAt ? ([['Suspensa em', formatShortDate(d.suspendedAt)]] as [string, string][]) : []),
    ...(d.suspensionReason ? ([['Motivo', d.suspensionReason]] as [string, string][]) : []),
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Detalhe da conta"
      description={user.email}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void reset()} loading={resetting}>
              Repor acesso
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button disabled={user.id === actor?.id} onClick={() => setConfirming(true)}>
              Repor acesso
            </Button>
          </>
        )
      }
    >
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows(state.data).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {confirming && (
            <p className="text-sm text-muted">
              Termina todas as sessões e envia a {user.email} um e-mail para definir novo acesso. Nunca vê nem define a
              palavra-passe.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Contas de utilizador (`/admin/users`, FR-ADM-01, R10): só o essencial, nunca dados de saúde. */
export function AdminUsersPage() {
  const { user: actor } = useAuth()
  const toast = useToast()
  const [term, setTerm] = useState('')
  const trimmed = term.trim()
  // Só pesquisa com 2+ caracteres (a API recusa 1); vazio mostra tudo.
  const query = trimmed.length >= ADMIN_SEARCH_MIN ? trimmed : ''
  const { state, reload } = useAsync(() => adminService.listUsers(undefined, query || undefined), [query])
  const [detail, setDetail] = useState<AdminUser | null>(null)
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
      const page = await adminService.listUsers(nextCursor, query || undefined)
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
      <Input
        label="Pesquisar"
        type="search"
        placeholder="E-mail ou nome (mín. 2 letras)"
        icon={Search}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

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
                    <span className="block truncate text-sm text-muted">
                      {user.name}
                      {user.id === actor?.id ? ' · A sua conta' : ''}
                    </span>
                  </span>
                  <Badge tone={statusTone[user.status].tone} dot>
                    {statusTone[user.status].label}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setDetail(user)}
                    aria-label={`Ver detalhe da conta ${user.email}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    <Info className="size-4" aria-hidden />
                  </button>
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

      {detail && <UserDetailModal user={detail} onClose={() => setDetail(null)} />}

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
