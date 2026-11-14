import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { formatMoney, formatPercent, parseAmount } from '@/lib/insurerFormat'
import { eligibilityLightLabels, guideTypeLabels } from '@/lib/labels'
import { clinicAuthorizationsService } from '@/services/clinicAuthorizations.service'
import { clinicInsurersService } from '@/services/clinicInsurers.service'
import type { AuthorizationRequest, ClinicInsurer, InsurerEligibilityRequest, InsurerEligibilityResult } from '@/types/insurerOps'

/** Máximo da justificação (BR-AUT-12). */
export const JUSTIFICATION_MAX = 500
/** Aviso no próprio campo de texto livre (C2): nos 3 sítios onde a clínica escreve. */
export const NO_CLINICAL_HINT = 'Não escreva doença, sintomas nem resultados de exames.'

type Mode = 'cardNumber' | 'qrToken' | 'idDocument'
const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'cardNumber', label: 'Nº do cartão' },
  { value: 'qrToken', label: 'Código QR' },
  { value: 'idDocument', label: 'Documento' },
]
const STEPS = ['Beneficiário', 'Cobertura', 'Detalhes', 'Enviar'] as const

interface WizardProps {
  insurers: ClinicInsurer[]
  /** `processId` da marcação (agenda), quando o pedido nasce de um atendimento. */
  processId?: string
  /** Veio do botão «Pedir autorização» da agenda. */
  fromAgenda?: boolean
  onClose: () => void
  onCreated: (request: AuthorizationRequest) => void
}

/**
 * Pedir autorização em 4 passos (marco B fatia 3, UC-SEG-06): 1) quem é o beneficiário e que serviço; 2) semáforo (só sim/não e
 * copagamento, nunca a razão); 3) serviço e guia já preenchidos, valor, data e justificação ADMINISTRATIVA; 4) rever e enviar.
 * Sem dados clínicos: o formulário não tem campos de diagnóstico e avisa a clínica (C2).
 */
export function RequestAuthorizationWizard({ insurers, processId, fromAgenda = false, onClose, onCreated }: WizardProps) {
  const [step, setStep] = useState(0)
  const [insurerId, setInsurerId] = useState(insurers[0]?.id ?? '')
  const [mode, setMode] = useState<Mode>('cardNumber')
  const [value, setValue] = useState('')
  const [docType, setDocType] = useState('BI')
  const [docNumber, setDocNumber] = useState('')
  const [serviceCode, setServiceCode] = useState('')
  const [check, setCheck] = useState<InsurerEligibilityResult | null>(null)
  const [amount, setAmount] = useState('')
  const [expectedOn, setExpectedOn] = useState(todayISO())
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const insurer = insurers.find((i) => i.id === insurerId)
  const services = useAsync(() => clinicInsurersService.listServices(insurerId), [insurerId])
  const serviceList = services.state.status === 'success' ? services.state.data.items : []
  const service = serviceList.find((s) => s.code === serviceCode)
  // Se o seguradora/serviço mudar, o semáforo anterior deixa de valer.
  useEffect(() => setCheck(null), [insurerId, serviceCode, mode, value, docNumber, docType])

  function identification(): InsurerEligibilityRequest | null {
    if (mode === 'idDocument') return docNumber.trim() ? { idDocument: { type: docType, number: docNumber.trim() } } : null
    return value.trim() ? { [mode]: value.trim() } : null
  }

  async function verify() {
    const who = identification()
    if (!who) return setError(mode === 'cardNumber' ? 'Indique o número do cartão.' : mode === 'qrToken' ? 'Indique o código do QR.' : 'Indique o número do documento.')
    if (!serviceCode) return setError('Escolha o serviço.')
    setBusy(true)
    setError(null)
    try {
      const result = await clinicInsurersService.checkEligibility(insurerId, { ...who, serviceCode })
      setCheck(result)
      setStep(1)
    } catch (err) {
      setError(
        isAppError(err, 'RATE_LIMITED') ? 'Fez demasiadas verificações seguidas. Aguarde um pouco e tente de novo.' : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  function toDetails() {
    if (check?.light !== 'YELLOW') return
    setError(null)
    setStep(2)
  }

  function toReview() {
    if (parseAmount(amount) === null) return setError('Indique o valor do serviço, por exemplo 15000,50.')
    if (!expectedOn || expectedOn < todayISO()) return setError('Indique a data prevista (hoje ou depois).')
    if (!justification.trim()) return setError('Explique em poucas palavras porque pede a autorização.')
    setError(null)
    setStep(3)
  }

  async function send() {
    const who = identification()
    if (!who) return
    setBusy(true)
    setError(null)
    try {
      const created = await clinicAuthorizationsService.create({
        insurerId,
        ...who,
        serviceCode,
        requestedAmount: parseAmount(amount) ?? 0,
        expectedOn,
        justification: justification.trim(),
        ...(processId ? { processId } : {}),
      })
      onCreated(created)
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT')
          ? 'Já existe um pedido igual em análise para este beneficiário e serviço.'
          : isAppError(err, 'NOT_FOUND')
            ? 'Não foi possível identificar o beneficiário. Confirme os dados e tente de novo.'
            : isAppError(err, 'VALIDATION_ERROR')
              ? 'A seguradora não aceitou o pedido. Confirme o valor, a data e o serviço.'
              : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  // O contrato ainda não diz «pode pedir» (só `light`): só AMARELO permite pedido (BR-AUT-02); o servidor volta a decidir.
  const canRequest = check?.eligible === true && check.light === 'YELLOW'
  const light = check?.light ? eligibilityLightLabels[check.light] : null
  const LightIcon = check?.light === 'GREEN' ? CircleCheck : check?.light === 'RED' ? CircleX : TriangleAlert
  const guide = service?.guideType ? guideTypeLabels[service.guideType] : null

  return (
    <Modal
      open
      onClose={onClose}
      title="Pedir autorização"
      description={`Passo ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}
      footer={
        <>
          {step === 1 && !canRequest ? (
            <>
              <Button variant="secondary" onClick={() => setStep(0)}>Alterar dados</Button>
              <Button onClick={onClose}>Fechar</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={step === 0 ? onClose : () => setStep(step - 1)}>
              {step === 0 ? 'Cancelar' : 'Voltar'}
            </Button>
          )}
          {step === 0 && <Button onClick={() => void verify()} loading={busy}>Ver cobertura</Button>}
          {step === 1 && canRequest && <Button onClick={toDetails}>Continuar</Button>}
          {step === 2 && <Button onClick={toReview}>Rever pedido</Button>}
          {step === 3 && <Button onClick={() => void send()} loading={busy}>Enviar pedido</Button>}
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        {step === 0 && (
          <>
            {fromAgenda && !processId && (
              <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
                Este atendimento ainda não tem processo: o pedido não fica ligado ao atendimento. Indique o beneficiário e o serviço.
              </p>
            )}
            {insurers.length > 1 && (
              <Select label="Seguradora do cartão" value={insurerId} onChange={(e) => setInsurerId(e.target.value)} options={insurers.map((i) => ({ value: i.id, label: i.name }))} />
            )}
            <Tabs label="Identificar o beneficiário por" items={MODES} value={mode} onChange={setMode} />
            {mode === 'idDocument' ? (
              <div className="grid grid-cols-2 gap-3">
                <Select label="Tipo de documento" value={docType} onChange={(e) => setDocType(e.target.value)} options={['BI', 'Passaporte', 'Cartão de residente', 'Outro'].map((v) => ({ value: v, label: v }))} />
                <Input label="Nº do documento" value={docNumber} autoComplete="off" onChange={(e) => setDocNumber(e.target.value)} />
              </div>
            ) : (
              <Input label={mode === 'cardNumber' ? 'Número do cartão' : 'Código do QR do cartão'} value={value} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
            )}
            {services.state.status === 'loading' ? (
              <LoadingState rows={1} />
            ) : (
              <Select
                label="Serviço"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                options={[{ value: '', label: 'Escolha o serviço…' }, ...serviceList.map((s) => ({ value: s.code, label: s.name }))]}
              />
            )}
          </>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {service?.name} · {insurer?.name}
            </p>
            {/* Região viva fixa: o leitor de ecrã anuncia o resultado quando aparece. */}
            <div role="status" aria-live="polite" className="flex flex-col gap-3">
              {check?.eligible && light ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{check.beneficiaryName}</span>
                    <Badge tone={light.tone}>
                      <LightIcon className="mr-1 inline size-4" aria-hidden />
                      {light.label}
                    </Badge>
                  </p>
                  <p className="text-sm">{light.hint}</p>
                  {check.patientSharePct != null && <p className="text-sm">O paciente paga {formatPercent(check.patientSharePct)} no balcão.</p>}
                </>
              ) : (
                <p className="text-sm">Não foi possível confirmar cobertura para este beneficiário. Confirme os dados do cartão.</p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Serviço</dt>
                <dd className="font-medium">{service?.name}</dd>
              </div>
              <div>
                <dt className="text-muted">Tipo de guia</dt>
                <dd className="font-medium">{guide ?? 'Definido pela seguradora'}</dd>
              </div>
            </dl>
            <Input label={`Valor do serviço (${insurer?.currency ?? ''})`} inputMode="decimal" hint="Ex.: 15000,50" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input label="Data prevista" type="date" min={todayISO()} value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
            <Textarea
              label="Porque pede a autorização"
              maxLength={JUSTIFICATION_MAX}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              hint={`${NO_CLINICAL_HINT} Até ${JUSTIFICATION_MAX} caracteres.`}
            />
          </>
        )}

        {step === 3 && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Beneficiário</dt><dd className="font-medium">{check?.beneficiaryName}</dd></div>
            <div><dt className="text-muted">Serviço</dt><dd className="font-medium">{service?.name}</dd></div>
            <div><dt className="text-muted">Valor</dt><dd className="font-medium">{formatMoney(parseAmount(amount) ?? 0, insurer?.currency)}</dd></div>
            <div><dt className="text-muted">Data prevista</dt><dd className="font-medium">{formatShortDate(expectedOn)}</dd></div>
            <div className="col-span-2"><dt className="text-muted">Justificação</dt><dd>{justification}</dd></div>
          </dl>
        )}

        <FormError message={error} />
      </div>
    </Modal>
  )
}
