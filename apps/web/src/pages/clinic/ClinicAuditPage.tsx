import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { errorMessage } from '@/lib/errors'
import { formatShortDate, formatTime } from '@/lib/format'
import { auditActionLabel, auditActionOptions, auditResultLabel } from '@/lib/receipt'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { clinicReceiptService } from '@/services/clinicReceipt.service'
import type { ClinicAccount } from '@/types/clinic'
import type { ClinicAuditEntry } from '@/types/clinicReceipt'

const PAGE_SIZE = 50

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: ClinicAuditEntry[]; nextCursor: string | null }

/**
 * Auditoria da clínica (UC-CLN-31, BR-CLN-40): só o Admin. Lista, do mais recente para o mais
 * antigo, quem da equipa fez o quê e quando — sem endereços, e-mails de pacientes nem dados
 * pessoais. A conta resolve-se pela lista da equipa (a API só devolve o id).
 */
export function ClinicAuditPage() {
  const { session } = useClinicAuth()
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [staff, setStaff] = useState<ClinicAccount[]>([])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    clinicPortalService.listStaff().then(setStaff, () => undefined)
  }, [])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    clinicReceiptService
      .listAudit({ action: action || undefined, actorAccountId: actor || undefined, limit: PAGE_SIZE })
      .then(
        (page) => active && setState({ status: 'success', ...page }),
        (error: unknown) => active && setState({ status: 'error', message: errorMessage(error) }),
      )
    return () => {
      active = false
    }
  }, [action, actor, attempt])

  async function loadMore() {
    if (state.status !== 'success' || !state.nextCursor) return
    setLoadingMore(true)
    try {
      const page = await clinicReceiptService.listAudit({
        action: action || undefined,
        actorAccountId: actor || undefined,
        limit: PAGE_SIZE,
        cursor: state.nextCursor,
      })
      setState({ status: 'success', items: [...state.items, ...page.items], nextCursor: page.nextCursor })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    } finally {
      setLoadingMore(false)
    }
  }

  /** A conta que agiu: da equipa pelo e-mail; sem id, foi removida; caso contrário, é a do Admin da clínica. */
  function actorLabel(entry: ClinicAuditEntry): string {
    if (!entry.actorAccountId) return 'Conta removida'
    const account = staff.find((a) => a.id === entry.actorAccountId)
    if (account) return account.email
    return session?.email ? `${session.email} (Admin)` : 'Admin da clínica'
  }

  return (
    <>
      <Link to={paths.clinicSettings} className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden />
        Definições
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Auditoria</h1>
        <p className="text-sm text-muted">As ações das contas da sua clínica. Não inclui dados de pacientes.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <Select
            label="Ação"
            value={action}
            placeholder="Todas as ações"
            options={auditActionOptions}
            onChange={(event) => setAction(event.target.value)}
          />
        </div>
        <div className="w-64">
          <Select
            label="Conta"
            value={actor}
            placeholder="Todas as contas"
            options={staff.map((a) => ({ value: a.id, label: a.email }))}
            onChange={(event) => setActor(event.target.value)}
          />
        </div>
      </div>

      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={() => setAttempt((n) => n + 1)} />}
      {state.status === 'success' &&
        (state.items.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {state.items.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{auditActionLabel(entry.action)}</p>
                  <p className="truncate text-sm text-muted">{actorLabel(entry)}</p>
                </div>
                {entry.result !== 'SUCCESS' && (
                  <Badge tone="warning" dot>
                    {auditResultLabel[entry.result]}
                  </Badge>
                )}
                <p className="shrink-0 text-right text-sm text-muted tabular-nums">
                  {formatShortDate(entry.occurredAt)}
                  <span className="block">{formatTime(entry.occurredAt)}</span>
                </p>
              </div>
            ))}
            {state.nextCursor && (
              <div className="flex justify-center py-3">
                <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                  Carregar mais
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <EmptyState icon={History} title="Sem registos." description="Ainda não há ações registadas com estes filtros." />
        ))}
    </>
  )
}
