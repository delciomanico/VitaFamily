import { useEffect, useState } from 'react'
import { Bluetooth, CircleCheck, LoaderCircle, ShieldCheck, Watch } from 'lucide-react'
import { DemoBanner, OriginBadge } from '@/components/domain/WatchParts'
import { WizardSheet } from '@/components/app/FormSheet'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ErrorState } from '@/components/ui/states'
import { metricLabels } from '@/lib/wearableSimulator'
import { useModalRoute } from '@/lib/modalRoute'
import { paths } from '@/routes/paths'
import { wearableService } from '@/services/wearable.service'
import type { MetricType, WatchModel } from '@/types/wearable'

const TOTAL_STEPS = 4
const STEP_TITLES = ['A sua privacidade primeiro', 'Escolha o relógio', 'Permissões', 'Relógio ligado'] as const

/** Fluxo de ligação (folha em ecrã inteiro por cima do Relógio): consentimento → escolher fonte → permissões → pronto (docs/wearables/03 §4.1). */
export function ConnectWatchPage() {
  const { close, saved } = useModalRoute(paths.watch)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [consent, setConsent] = useState(false)
  const [models, setModels] = useState<WatchModel[] | null>(null)
  const [scanError, setScanError] = useState(false)
  const [model, setModel] = useState<WatchModel | null>(null)
  const [granted, setGranted] = useState<MetricType[]>([])
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (step !== 2 || models) return
    let active = true
    wearableService.discover().then(
      (found) => active && setModels(found),
      () => active && setScanError(true),
    )
    return () => {
      active = false
    }
  }, [step, models])

  function choose(next: WatchModel) {
    setModel(next)
    setGranted(next.capabilities)
  }

  async function connect() {
    if (!model) return
    setConnecting(true)
    try {
      await wearableService.connect(model.id, granted)
      setStep(4)
    } catch {
      setError('Não foi possível ligar o relógio.')
    } finally {
      setConnecting(false)
    }
  }

  function toggle(type: MetricType, checked: boolean) {
    setError(null)
    setGranted((current) => (checked ? [...current, type] : current.filter((t) => t !== type)))
  }

  function onNext() {
    setError(null)
    if (step === 1) return setStep(2)
    if (step === 2) return model ? setStep(3) : setError('Escolha o relógio.')
    if (step === 3) return void connect()
    saved()
  }

  return (
    <WizardSheet
      title="Conectar relógio"
      stepTitle={STEP_TITLES[step - 1] ?? ''}
      step={step - 1}
      total={TOTAL_STEPS}
      onBack={() => {
        setError(null)
        setStep((current) => Math.max(1, current - 1))
      }}
      onNext={onNext}
      nextLabel={step === 3 ? 'Permitir e ligar' : step === 4 ? 'Ver os meus dados' : 'Continuar'}
      nextDisabled={(step === 1 && !consent) || (step === 3 && granted.length === 0)}
      busy={connecting}
      error={error}
      dirty={step > 1 && step < 4}
      onClose={close}
    >
      <DemoBanner />

      {step === 1 && (
        <>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <ul className="list-disc space-y-2 pl-5 text-base">
            <li>Lemos do Health Connect só os tipos de dados que escolher no passo seguinte.</li>
            <li>Os dados do relógio ficam separados do seu histórico de saúde e não entram nos relatórios.</li>
            <li>Não partilhamos estes dados com outros familiares nem com terceiros.</li>
            <li>Pode desligar o relógio e apagar os dados quando quiser.</li>
            <li>É informação de bem-estar, não um diagnóstico.</li>
          </ul>
          <Checkbox label="Autorizo a Vita Family a ler os dados do meu relógio." checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        </>
      )}

      {step === 2 && (
        <>
          {scanError && <ErrorState message="Não foi possível procurar relógios." onRetry={() => setScanError(false)} />}
          {!models && !scanError && (
            <Card role="status" className="flex items-center gap-3">
              <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
              <span className="text-base">A procurar relógios no Health Connect…</span>
            </Card>
          )}
          {models && (
            <ul className="flex flex-col gap-3">
              {models.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    aria-pressed={model?.id === candidate.id}
                    onClick={() => choose(candidate)}
                    className={`flex w-full items-center gap-3 rounded-xl border bg-surface p-4 text-left shadow-card transition-colors ${model?.id === candidate.id ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-border-strong'}`}
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Bluetooth className="size-5" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">
                        {candidate.manufacturer} {candidate.model}
                      </span>
                      <span className="text-sm text-muted">
                        via {candidate.sourceApp} · {candidate.capabilities.length} tipos de dados
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted">Demonstração: estes três relógios são simulados e fornecem tipos de dados diferentes.</p>
        </>
      )}

      {step === 3 && model && (
        <>
          <p className="text-base text-muted">
            O {model.manufacturer} {model.model} fornece estes dados. Escolha o que a Vita Family pode ler.
          </p>
          <ul className="flex flex-col gap-3">
            {model.capabilities.map((type) => (
              <li key={type} className="flex items-center justify-between gap-3">
                <Checkbox label={metricLabels[type]} checked={granted.includes(type)} onChange={(event) => toggle(type, event.target.checked)} />
                <OriginBadge origin={model.origins[type] ?? 'THIRD_PARTY_APP'} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Não mostramos dados que o relógio não fornece.</p>
        </>
      )}

      {step === 4 && model && (
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-8" aria-hidden />
          </span>
          <p className="text-base text-muted">
            <Watch className="mr-1 inline size-4" aria-hidden />
            {model.manufacturer} {model.model} · {granted.length} {granted.length === 1 ? 'tipo de dados' : 'tipos de dados'} autorizados. A primeira sincronização já foi feita.
          </p>
        </div>
      )}
    </WizardSheet>
  )
}
