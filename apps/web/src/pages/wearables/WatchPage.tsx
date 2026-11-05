import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, RefreshCw, TriangleAlert, Unplug, Watch } from 'lucide-react'
import { DemoBanner, metricIcons, OriginBadge, WellnessNotice } from '@/components/domain/WatchParts'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Card, CardLink, Section } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Disclosure } from '@/components/ui/Disclosure'
import { InfoList, InfoRow } from '@/components/ui/InfoList'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { metricLabels, metricSlugs } from '@/lib/wearableSimulator'
import { paths } from '@/routes/paths'
import { formatSyncAge, wearableService, type WatchStatus } from '@/services/wearable.service'
import type { MetricType, WatchProblem } from '@/types/wearable'

const problemText: Record<WatchProblem, { title: string; description: string; action: string }> = {
  PERMISSION_REVOKED: {
    title: 'Permissões retiradas',
    description: 'O acesso aos dados foi retirado no Health Connect. Sem ele não é possível sincronizar.',
    action: 'Conceder permissões',
  },
  SOURCE_STALE: {
    title: 'O relógio não sincronizou com o telemóvel',
    description: 'Abra a app do fabricante para sincronizar o relógio e volte a tentar.',
    action: 'Tentar novamente',
  },
}

/** Ritmo cardíaco "ao vivo" simulado: atualiza a cada 2 segundos enquanto o painel está aberto. */
function LiveHeartRate({ status }: { status: WatchStatus }) {
  const [bpm, setBpm] = useState(() => wearableService.liveHeartRate(status.model))
  useEffect(() => {
    const id = window.setInterval(() => setBpm(wearableService.liveHeartRate(status.model)), 2000)
    return () => window.clearInterval(id)
  }, [status.model])
  return (
    <Card className="flex items-center gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
        <Heart className="size-7 animate-pulse" aria-hidden />
      </span>
      <div className="flex-1">
        <p className="text-sm text-muted">Frequência cardíaca agora (simulada)</p>
        <p className="text-3xl font-bold tabular-nums" aria-live="off">
          {bpm} <span className="text-base font-medium text-muted">bpm</span>
        </p>
      </div>
    </Card>
  )
}

function ConnectHero() {
  return (
    <>
      <EmptyState
        icon={Watch}
        title="Nenhum relógio ligado"
        description="Ligue o seu smartwatch para ver aqui os passos, o sono e a frequência cardíaca. Estes dados ficam separados do seu histórico de saúde."
        action={
          <Link to={paths.watchConnect} className={buttonClasses({ size: 'lg' })}>
            Conectar relógio
          </Link>
        }
      />
      <Section title="Como funciona">
        <Card className="flex flex-col gap-3 text-sm">
          <p>
            <strong>1.</strong> O relógio sincroniza com a app do fabricante (Samsung Health, Garmin Connect, …).
          </p>
          <p>
            <strong>2.</strong> A Vita Family lê esses dados através do Health Connect do Android, só com a sua
            autorização.
          </p>
          <p>
            <strong>3.</strong> Não precisa de instalar nada no relógio. Pode desligar e apagar os dados quando quiser.
          </p>
        </Card>
      </Section>
    </>
  )
}

function Connected({ status, onChange }: { status: WatchStatus; onChange: () => void }) {
  const toast = useToast()
  const { connection, model } = status
  const [syncing, setSyncing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const values = wearableService.todayValues(status)
  const granted = model.capabilities.filter((type) => connection.grantedTypes.includes(type))
  const blocked = connection.problem === 'PERMISSION_REVOKED'

  async function sync() {
    setSyncing(true)
    try {
      const result = await wearableService.sync()
      toast.show(
        `${result.accepted} novas leituras, ${result.duplicates} duplicadas ignoradas.${result.note ? ` ${result.note}` : ''}`,
      )
      onChange()
    } finally {
      setSyncing(false)
    }
  }

  async function toggle(type: MetricType, enabled: boolean) {
    const next = enabled ? [...connection.grantedTypes, type] : connection.grantedTypes.filter((t) => t !== type)
    await wearableService.setGrantedTypes(next)
    onChange()
  }

  async function disconnect() {
    setDeleting(true)
    try {
      await wearableService.disconnect()
      toast.show('Relógio desligado e dados apagados.')
      onChange()
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Watch className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {model.manufacturer} {model.model}
            </p>
            <p className="text-sm text-muted">Dados via {model.sourceApp}</p>
          </div>
          {connection.problem ? (
            <Badge tone="warning" dot>
              Com problema
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Ligado
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Última sincronização: {formatSyncAge(connection.lastSyncAt)}</p>
          <Button size="sm" variant="soft" loading={syncing} disabled={blocked} onClick={() => void sync()} icon={<RefreshCw className="size-4" />}>
            Sincronizar agora
          </Button>
        </div>
      </Card>

      {connection.problem && (
        <div role="alert" className="flex items-start gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex flex-1 flex-col gap-2">
            <p className="font-semibold">{problemText[connection.problem].title}</p>
            <p>{problemText[connection.problem].description}</p>
            <Button
              size="sm"
              className="self-start"
              onClick={() =>
                void (connection.problem === 'PERMISSION_REVOKED'
                  ? wearableService.setGrantedTypes(connection.grantedTypes).then(onChange)
                  : sync())
              }
            >
              {problemText[connection.problem].action}
            </Button>
          </div>
        </div>
      )}

      {granted.includes('HEART_RATE') && !blocked && <LiveHeartRate status={status} />}

      <Section title="Os seus dados">
        {granted.length === 0 ? (
          <p className="text-sm text-muted">Nenhum tipo de dados autorizado. Ative-os em «Permissões».</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {granted.map((type) => {
              const Icon = metricIcons[type]
              return (
                <li key={type}>
                  <CardLink to={paths.watchMetric(metricSlugs[type])} className="h-full">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm text-muted">{metricLabels[type]}</span>
                        <span className="font-semibold">{values[type]}</span>
                        <span>
                          <OriginBadge origin={model.origins[type] ?? 'THIRD_PARTY_APP'} />
                        </span>
                      </span>
                    </div>
                  </CardLink>
                </li>
              )
            })}
          </ul>
        )}
        <WellnessNotice />
      </Section>

      <Section title="Permissões e dispositivo">
        <Card className="divide-y divide-border py-1">
          {model.capabilities.map((type) => (
            <Switch
              key={type}
              label={metricLabels[type]}
              checked={connection.grantedTypes.includes(type)}
              onChange={(checked) => void toggle(type, checked)}
            />
          ))}
        </Card>
        <p className="text-xs text-muted">
          Só aparecem os tipos de dados que este relógio fornece. A Vita Family apenas lê, nunca escreve.
        </p>
        <InfoList>
          <InfoRow label="Fabricante" value={model.manufacturer} />
          <InfoRow label="Modelo" value={model.model} />
          <InfoRow label="Fonte (Health Connect)" value={model.sourceApp} />
          <InfoRow label="Ligado desde" value={new Date(connection.connectedAt).toLocaleString('pt-PT')} />
        </InfoList>
        <Button variant="danger-ghost" className="self-start" icon={<Unplug className="size-4" />} onClick={() => setConfirmOpen(true)}>
          Desconectar relógio
        </Button>
      </Section>

      <Disclosure label="Controlos de demonstração">
        <Card className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Provoque estados de erro para mostrar como a app reage.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void wearableService.simulateProblem('PERMISSION_REVOKED').then(onChange)}>
              Retirar permissões
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void wearableService.simulateProblem('SOURCE_STALE').then(onChange)}>
              Relógio sem sincronizar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void wearableService.simulateProblem(null).then(onChange)}>
              Limpar problema
            </Button>
          </div>
        </Card>
      </Disclosure>

      <ConfirmDialog
        open={confirmOpen}
        title="Desconectar relógio?"
        description="A Vita Family deixa de receber dados deste relógio e os dados já recebidos são apagados. Pode voltar a ligá-lo quando quiser."
        confirmLabel="Desconectar"
        destructive
        loading={deleting}
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

export function WatchPage() {
  const { state, reload } = useAsync(() => wearableService.getStatus(), [])

  return (
    <Page title="Relógio" backTo={paths.home} backLabel="Início">
      <DemoBanner />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (state.data ? <Connected status={state.data} onChange={reload} /> : <ConnectHero />)}
    </Page>
  )
}
