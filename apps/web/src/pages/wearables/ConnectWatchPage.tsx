import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bluetooth, CircleCheck, LoaderCircle, ShieldCheck, Watch } from 'lucide-react'
import { DemoBanner, OriginBadge } from '@/components/domain/WatchParts'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { StepProgress } from '@/components/ui/StepProgress'
import { ErrorState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { metricLabels } from '@/lib/wearableSimulator'
import { paths } from '@/routes/paths'
import { wearableService } from '@/services/wearable.service'
import type { MetricType, WatchModel } from '@/types/wearable'

const TOTAL_STEPS = 4

/** Fluxo de ligação: consentimento → escolher fonte → permissões → pronto (docs/wearables/03 §4.1). */
export function ConnectWatchPage() {
  const navigate = useNavigate()
  const toast = useToast()
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
    setStep(3)
  }

  async function connect() {
    if (!model) return
    setConnecting(true)
    try {
      await wearableService.connect(model.id, granted)
      setStep(4)
    } catch {
      toast.show('Não foi possível ligar o relógio.', 'error')
    } finally {
      setConnecting(false)
    }
  }

  function toggle(type: MetricType, checked: boolean) {
    setGranted((current) => (checked ? [...current, type] : current.filter((t) => t !== type)))
  }

  return (
    <Page title="Conectar relógio" backTo={paths.watch} backLabel="Relógio">
      <DemoBanner />
      <div className="flex items-center gap-3">
        <StepProgress step={step} total={TOTAL_STEPS} label="Progresso da ligação do relógio" />
      </div>

      {step === 1 && (
        <Card className="flex flex-col gap-4">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">A sua privacidade primeiro</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Lemos do Health Connect só os tipos de dados que escolher no passo seguinte.</li>
            <li>Os dados do relógio ficam separados do seu histórico de saúde e não entram nos relatórios.</li>
            <li>Não partilhamos estes dados com outros familiares nem com terceiros.</li>
            <li>Pode desligar o relógio e apagar os dados quando quiser.</li>
            <li>É informação de bem-estar, não um diagnóstico.</li>
          </ul>
          <Checkbox
            label="Autorizo a Vita Family a ler os dados do meu relógio."
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <Button size="lg" disabled={!consent} onClick={() => setStep(2)}>
            Continuar
          </Button>
        </Card>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Fontes de dados encontradas</h2>
          {scanError && <ErrorState message="Não foi possível procurar relógios." onRetry={() => setScanError(false)} />}
          {!models && !scanError && (
            <Card role="status" className="flex items-center gap-3">
              <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
              <span className="text-sm">A procurar relógios no Health Connect…</span>
            </Card>
          )}
          {models && (
            <ul className="flex flex-col gap-3">
              {models.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => choose(candidate)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-card transition-colors hover:border-border-strong"
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
          <p className="text-xs text-muted">
            Demonstração: estes três relógios são simulados e fornecem tipos de dados diferentes.
          </p>
        </div>
      )}

      {step === 3 && model && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Permissões</h2>
          <p className="text-sm text-muted">
            O {model.manufacturer} {model.model} fornece estes dados. Escolha o que a Vita Family pode ler.
          </p>
          <ul className="flex flex-col gap-3">
            {model.capabilities.map((type) => (
              <li key={type} className="flex items-center justify-between gap-3">
                <Checkbox
                  label={metricLabels[type]}
                  checked={granted.includes(type)}
                  onChange={(event) => toggle(type, event.target.checked)}
                />
                <OriginBadge origin={model.origins[type] ?? 'THIRD_PARTY_APP'} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Não mostramos dados que o relógio não fornece.</p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Voltar
            </Button>
            <Button className="flex-1" loading={connecting} disabled={granted.length === 0} onClick={() => void connect()}>
              Permitir e ligar
            </Button>
          </div>
        </Card>
      )}

      {step === 4 && model && (
        <Card className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-8" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">Relógio ligado</h2>
          <p className="text-sm text-muted">
            <Watch className="mr-1 inline size-4" aria-hidden />
            {model.manufacturer} {model.model} · {granted.length}{' '}
            {granted.length === 1 ? 'tipo de dados' : 'tipos de dados'} autorizados. A primeira sincronização já foi feita.
          </p>
          <Button size="lg" onClick={() => navigate(paths.watch)}>
            Ver os meus dados
          </Button>
        </Card>
      )}
    </Page>
  )
}
