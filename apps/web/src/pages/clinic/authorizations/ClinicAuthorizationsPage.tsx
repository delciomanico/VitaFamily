import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { paths } from '@/routes/paths'
import { FileCheck2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { formatMoney } from '@/lib/insurerFormat'
import { authorizationStatus } from '@/lib/labels'
import { asArray } from '@/lib/safe'
import { clinicAuthorizationsService } from '@/services/clinicAuthorizations.service'
import { clinicInsurersService } from '@/services/clinicInsurers.service'
import type { ClinicInsurer } from '@/types/insurerOps'
import { AuthorizationDetailModal } from './AuthorizationDetailModal'
import { RequestAuthorizationWizard } from './RequestAuthorizationWizard'

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'OPEN', label: 'Em curso' },
  { value: 'INFO_REQUESTED', label: 'Falta informação' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'REJECTED', label: 'Recusados' },
  { value: 'CANCELLED', label: 'Cancelados' },
]

/**
 * Autorizações pedidas pela clínica (UC-SEG-06/08): lista com estado, pedir (4 passos) e abrir o detalhe.
 * Só Admin e Gestor. `?processId=` (vindo da agenda) pré-preenche o pedido e filtra a lista.
 */
export function ClinicAuthorizationsPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const processId = params.get('processId') ?? undefined
  const [status, setStatus] = useState('')
  const [requesting, setRequesting] = useState(params.get('new') === '1')
  const [fromAgenda] = useState(params.get('new') === '1')
  // O `new` serve só para abrir o assistente: tira-se do endereço (recarregar ou voltar não o reabre).
  useEffect(() => {
    if (params.get('new')) {
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }, [])
  const [openId, setOpenId] = useState<string | null>(null)
  const insurers = useAsync(
    () =>
      clinicInsurersService.listInsurers().catch((err: unknown): ClinicInsurer[] => {
        if (isAppError(err, 'NOT_FOUND')) return []
        throw err
      }),
    [],
  )
  const list = useAsync(() => clinicAuthorizationsService.list({ ...(status ? { status } : {}), ...(processId ? { processId } : {}) }), [status, processId])
  const linked = insurers.state.status === 'success' ? asArray(insurers.state.data) : []
  const noInsurer = insurers.state.status === 'success' && linked.length === 0

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Autorizações</h1>
          <p className="text-sm text-muted">Peça autorização à seguradora antes do serviço e acompanhe a resposta.</p>
        </div>
        <Button icon={<Plus className="size-4" aria-hidden />} disabled={linked.length === 0} onClick={() => setRequesting(true)}>
          Pedir autorização
        </Button>
      </div>
      {insurers.state.status === 'error' && <ErrorState message="Não foi possível carregar as seguradoras da clínica." onRetry={insurers.reload} />}
      {noInsurer && (
        <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
          A sua clínica ainda não está ligada a nenhuma seguradora, por isso não pode pedir autorizações.{' '}
          <Link to={paths.clinicInsurers} className="inline-flex min-h-11 items-center underline">Ver seguradoras</Link>
        </p>
      )}

      <div className="max-w-xs">
        <Select label="Mostrar" value={status} onChange={(e) => setStatus(e.target.value)} options={FILTERS} />
      </div>
      {processId && (
        <p className="text-sm text-muted">
          A mostrar só os pedidos deste atendimento.{' '}
          <button type="button" className="min-h-11 underline" onClick={() => setParams({})}>Ver todos</button>
        </p>
      )}

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (list.state.data.items.length === 0 ? (
          <EmptyState icon={FileCheck2} title="Ainda não há pedidos." description="Quando pedir uma autorização, ela aparece aqui com o estado." />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.state.data.items.map((item) => {
              const label = authorizationStatus[item.status]
              return (
                <li key={item.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <p className="font-medium">{item.serviceName} · {item.beneficiaryName}</p>
                      <p className="text-sm text-muted">
                        {item.insurerName} · {formatMoney(item.requestedAmount, item.currency)} · {formatShortDate(item.expectedOn)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={label.tone}>{label.label}</Badge>
                      <Button variant="secondary" aria-label={`Ver pedido ${item.serviceName}`} onClick={() => setOpenId(item.id)}>
                        Ver
                      </Button>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        ))}

      {requesting && (
        <RequestAuthorizationWizard
          insurers={linked}
          {...(processId ? { processId } : {})}
          fromAgenda={fromAgenda}
          onClose={() => setRequesting(false)}
          onCreated={(created) => {
            setRequesting(false)
            toast.show('Pedido enviado à seguradora.')
            list.reload()
            setOpenId(created.id)
          }}
        />
      )}
      {openId && <AuthorizationDetailModal authorizationId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  )
}
