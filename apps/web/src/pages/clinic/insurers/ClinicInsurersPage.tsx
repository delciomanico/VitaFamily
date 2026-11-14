import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, CircleX, Info, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePagedList } from '@/hooks/usePagedList'
import { AppError, errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { formatDays, formatMoney, formatPercent } from '@/lib/insurerFormat'
import { asArray } from '@/lib/safe'
import { clinicInsurersService } from '@/services/clinicInsurers.service'
import type { ClinicInsurer, InsurerEligibilityRequest, InsurerEligibilityResult } from '@/types/insurerOps'

/** Aviso fixo (BR-SEG-18, riscos da Fase A): a resposta nunca é garantia de pagamento. */
const COVERAGE_NOTICE = 'Verificação de cobertura, não garantia de pagamento.'

type Mode = 'cardNumber' | 'qrToken' | 'idDocument'

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'cardNumber', label: 'Nº do cartão' },
  { value: 'qrToken', label: 'Código QR' },
  { value: 'idDocument', label: 'Documento' },
]
const DOCUMENT_TYPES = ['BI', 'Passaporte', 'Cartão de residente', 'Outro']

/** Segundos a esperar, a partir do `Retry-After`; sem o cabeçalho usa-se um valor prudente. */
const DEFAULT_WAIT = 30

function Result({ result, currency }: { result: InsurerEligibilityResult; currency: string }) {
  const coverages = asArray(result.coverages)
  if (!result.eligible) {
    return (
      <Card role="status" className="flex flex-col gap-2 border-danger/40">
        <p className="flex items-center gap-2 font-semibold text-danger">
          <CircleX className="size-5" aria-hidden /> Não elegível
        </p>
        <p className="text-sm">
          Não foi possível confirmar cobertura para este beneficiário. A resposta é a mesma para um cartão inexistente, inelegível ou inválido.
        </p>
      </Card>
    )
  }
  return (
    <ErrorBoundary>
      <Card role="status" className="flex flex-col gap-3 border-success/40">
        <p className="flex items-center gap-2 font-semibold text-success">
          <CircleCheck className="size-5" aria-hidden /> Elegível
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Beneficiário</dt>
            <dd className="font-medium">{result.beneficiaryName}</dd>
          </div>
          <div>
            <dt className="text-muted">Plano</dt>
            <dd className="font-medium">{result.planName}</dd>
          </div>
          <div>
            <dt className="text-muted">Válido desde</dt>
            <dd className="font-medium">{result.validFrom ? formatShortDate(result.validFrom) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Válido até</dt>
            <dd className="font-medium">{result.validTo ? formatShortDate(result.validTo) : '—'}</dd>
          </div>
        </dl>
        {coverages.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Cobertura por serviço (valores em {result.currency ?? currency})</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Serviço</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Seguradora paga</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Teto anual</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Carência</th>
                  <th scope="col" className="py-1.5 font-medium">Autorização</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {coverages.map((c) => (
                  <tr key={c.serviceCode}>
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {c.serviceName}
                    </th>
                    <td className="py-2 pr-3">{formatPercent(c.copayPct)}</td>
                    <td className="py-2 pr-3">{c.limitPerYear != null ? formatMoney(c.limitPerYear, result.currency ?? currency) : 'Sem teto'}</td>
                    <td className="py-2 pr-3">
                      {c.coveredNow ? (
                        c.waitingDays > 0 ? 'Cumprida' : '—'
                      ) : (
                        <Badge tone="warning">
                          Em carência{c.waitingEndsOn ? ` até ${formatShortDate(c.waitingEndsOn)}` : `: ${formatDays(c.waitingDays)}`}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2">{c.requiresAuthorization ? <Badge tone="primary">Exige autorização</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Sem serviços cobertos para mostrar.</p>
        )}
      </Card>
    </ErrorBoundary>
  )
}

function ValidateForm({ insurer }: { insurer: ClinicInsurer }) {
  const [mode, setMode] = useState<Mode>('cardNumber')
  const [value, setValue] = useState('')
  const [docType, setDocType] = useState('BI')
  const [docNumber, setDocNumber] = useState('')
  const [serviceCode, setServiceCode] = useState('')
  const [result, setResult] = useState<InsurerEligibilityResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const services = useAsync(() => clinicInsurersService.listServices(insurer.id), [insurer.id])

  // Contagem decrescente após um 429: o botão fica desativado até poder tentar de novo.
  useEffect(() => {
    if (wait <= 0) return
    const timer = setInterval(() => setWait((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [wait > 0])

  const serviceOptions =
    services.state.status === 'success' ? services.state.data.items.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })) : []

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body: InsurerEligibilityRequest = {}
    if (mode === 'idDocument') {
      if (!docNumber.trim()) return setError('Indique o número do documento.')
      body.idDocument = { type: docType, number: docNumber.trim() }
    } else {
      if (!value.trim()) return setError(mode === 'cardNumber' ? 'Indique o número do cartão.' : 'Indique o código do QR.')
      body[mode] = value.trim()
    }
    if (serviceCode) body.serviceCode = serviceCode
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await clinicInsurersService.checkEligibility(insurer.id, body))
    } catch (err) {
      if (isAppError(err, 'RATE_LIMITED')) {
        const seconds = err instanceof AppError && err.retryAfterSeconds ? err.retryAfterSeconds : DEFAULT_WAIT
        setWait(seconds)
        setError(`Fez demasiadas validações seguidas. Aguarde ${seconds} segundos antes de tentar de novo.`)
      } else if (isAppError(err, 'NOT_FOUND')) {
        setError('Esta seguradora já não está disponível para a sua clínica. Atualize a página.')
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="note" className="flex items-start gap-2 rounded-md bg-primary-soft px-3.5 py-3 text-sm text-primary">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">{COVERAGE_NOTICE}</strong> A seguradora pode recusar o pagamento mesmo com cobertura confirmada. Use o cartão apresentado pelo paciente para escolher a seguradora.
        </span>
      </p>
      <form onSubmit={(e) => void submit(e)} aria-label="Validar beneficiário" className="flex flex-col gap-4">
        <Tabs
          label="Identificar o beneficiário por"
          items={MODES}
          value={mode}
          onChange={(next) => {
            setMode(next)
            setError(null)
            setResult(null)
          }}
        />
        {mode === 'idDocument' ? (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo de documento" value={docType} onChange={(e) => setDocType(e.target.value)} options={DOCUMENT_TYPES.map((v) => ({ value: v, label: v }))} />
            <Input label="Nº do documento" value={docNumber} autoComplete="off" onChange={(e) => setDocNumber(e.target.value)} />
          </div>
        ) : (
          <Input
            label={mode === 'cardNumber' ? 'Número do cartão' : 'Código do QR do cartão'}
            value={value}
            autoComplete="off"
            hint={mode === 'qrToken' ? 'Cole o código lido do QR do cartão digital do paciente.' : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <Select
          label="Serviço (opcional)"
          value={serviceCode}
          onChange={(e) => setServiceCode(e.target.value)}
          placeholder="Todos os serviços cobertos"
          options={serviceOptions}
          hint="Limita a resposta a um serviço da lista da seguradora."
        />
        <FormError message={error} />
        <Button type="submit" loading={busy} disabled={wait > 0} className="self-start">
          {wait > 0 ? `Aguarde ${wait} s` : 'Validar cobertura'}
        </Button>
      </form>
      {result && <Result result={result} currency={insurer.currency} />}
      {result && <p className="text-sm text-muted">{result.notice || COVERAGE_NOTICE}</p>}
    </div>
  )
}

function ServicesList({ insurer }: { insurer: ClinicInsurer }) {
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const list = usePagedList((cursor) => clinicInsurersService.listServices(insurer.id, { q: applied, cursor }), [insurer.id, applied])

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        aria-label="Pesquisar serviços da seguradora"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(q.trim())
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Input label="Código ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" className="mb-6">
          Pesquisar
        </Button>
      </form>
      {list.status === 'loading' && <LoadingState rows={3} />}
      {list.status === 'error' && (
        <ErrorState
          message={isAppError(list.error, 'NOT_FOUND') ? 'Esta seguradora já não está disponível para a sua clínica.' : undefined}
          onRetry={list.reload}
        />
      )}
      {list.status === 'success' && list.items.length === 0 && (
        <EmptyState icon={ShieldCheck} title="Sem serviços." description="A seguradora ainda não publicou serviços ativos." />
      )}
      {list.status === 'success' && list.items.length > 0 && (
        <ErrorBoundary resetKey={list.items.length}>
          <Card className="divide-y divide-border py-1">
            {list.items.map((s) => (
              <div key={s.code} className="py-3">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-muted">
                  {s.code}
                  {s.category ? ` · ${s.category}` : ''}
                </p>
              </div>
            ))}
          </Card>
          {list.hasMore && (
            <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore} className="self-center">
              Carregar mais
            </Button>
          )}
        </ErrorBoundary>
      )}
    </div>
  )
}

/**
 * Seguradoras na clínica (UC-SEG-05, Fase A): validar um beneficiário e consultar a lista de serviços.
 * Só Admin e Gestor (o Médico não vê o item nem a rota). A clínica escolhe a seguradora do cartão
 * apresentado (Q4); a resposta é mínima e nunca garante pagamento (BR-SEG-18).
 */
export function ClinicInsurersPage() {
  const insurers = useAsync(() => clinicInsurersService.listInsurers(), [])
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<'validate' | 'services'>('validate')

  if (insurers.state.status === 'loading') return <LoadingState rows={2} />
  // 404 sem enumeração: clínica não ligada a nenhuma seguradora com módulo ativo.
  const notLinked = insurers.state.status === 'error' && isAppError(insurers.state.error, 'NOT_FOUND')
  if (insurers.state.status === 'error' && !notLinked) return <ErrorState onRetry={insurers.reload} />
  const list = insurers.state.status === 'success' ? asArray(insurers.state.data) : []

  const insurer = list.find((i) => i.id === selected) ?? list[0]
  if (!insurer) {
    return (
      <>
        <h1 className="text-xl font-semibold">Seguradoras</h1>
        <EmptyState
          icon={ShieldCheck}
          title="Sem seguradoras ligadas."
          description="Quando uma seguradora ligar a sua clínica, poderá validar aqui a cobertura dos seus beneficiários."
        />
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Seguradoras</h1>
        <p className="text-sm text-muted">Valide a cobertura de um beneficiário e consulte os serviços da seguradora.</p>
      </div>

      {list.length > 1 ? (
        <Select
          label="Seguradora do cartão"
          value={insurer.id}
          onChange={(e) => setSelected(e.target.value)}
          options={list.map((i) => ({ value: i.id, label: i.name }))}
        />
      ) : (
        <p className="text-sm">
          Seguradora: <span className="font-medium">{insurer.name}</span> · moeda {insurer.currency}
        </p>
      )}

      <Tabs
        label="Seguradora"
        items={[
          { value: 'validate', label: 'Validar beneficiário' },
          { value: 'services', label: 'Serviços' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {/* `key` repõe o formulário (e o resultado) ao mudar de seguradora: nada transita entre seguradoras. */}
      {tab === 'validate' ? <ValidateForm key={insurer.id} insurer={insurer} /> : <ServicesList key={insurer.id} insurer={insurer} />}
    </>
  )
}
