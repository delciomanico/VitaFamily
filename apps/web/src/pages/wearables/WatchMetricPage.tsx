import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { DemoBanner, OriginBadge, WellnessNotice } from '@/components/domain/WatchParts'
import { SeriesChart } from '@/components/domain/SeriesChart'
import { Page } from '@/components/layout/Page'
import { Card } from '@/components/ui/Card'
import { InfoList, InfoRow } from '@/components/ui/InfoList'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { formatDuration, metricFromSlug, metricLabels, metricRanges } from '@/lib/wearableSimulator'
import { paths } from '@/routes/paths'
import { wearableService } from '@/services/wearable.service'
import type { MetricRange, MetricType } from '@/types/wearable'
import { Watch } from 'lucide-react'

const rangeLabels: Record<MetricRange, string> = { DAY: 'Hoje', WEEK: '7 dias', MONTH: '30 dias' }

function MetricBody({ type }: { type: MetricType }) {
  const ranges = metricRanges[type]
  const [range, setRange] = useState<MetricRange>(ranges.includes('WEEK') ? 'WEEK' : (ranges[0] ?? 'WEEK'))
  const { state, reload } = useAsync(() => wearableService.getMetric(type, range), [type, range])
  const night = useAsync(() => wearableService.getSleepNight(), [])
  const tabs: TabItem<MetricRange>[] = ranges.map((value) => ({ value, label: rangeLabels[value] }))

  return (
    <>
      <Tabs items={tabs} value={range} onChange={setRange} label="Intervalo de tempo" />
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && !state.data && (
        <EmptyState icon={Watch} title="Sem dados" description="Este tipo de dados não está autorizado ou o relógio não o fornece." />
      )}
      {state.status === 'success' && state.data && (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <p className="text-3xl font-bold tabular-nums">
                {state.data.summary.headline}{' '}
                <span className="text-base font-medium text-muted">{state.data.summary.unit}</span>
              </p>
              <OriginBadge origin={state.data.origin} />
            </div>
            <SeriesChart
              points={state.data.points}
              kind={state.data.kind}
              label={`${metricLabels[type]}, ${rangeLabels[range]}`}
              unit={type === 'BLOOD_PRESSURE' ? 'sistólica (azul) · diastólica (cinza)' : undefined}
            />
          </Card>
          <InfoList>
            {state.data.summary.details.map((detail) => (
              <InfoRow key={detail.label} label={detail.label} value={detail.value} />
            ))}
          </InfoList>
          {type === 'SLEEP' && night.state.status === 'success' && night.state.data && (
            <Card className="flex flex-col gap-2">
              <h2 className="font-semibold">Última noite</h2>
              <InfoList className="border-0 shadow-none">
                <InfoRow label="Total" value={formatDuration(night.state.data.totalMinutes)} />
                <InfoRow label="Sono profundo" value={formatDuration(night.state.data.deep)} />
                <InfoRow label="Sono leve" value={formatDuration(night.state.data.light)} />
                <InfoRow label="REM" value={formatDuration(night.state.data.rem)} />
                <InfoRow label="Acordado" value={formatDuration(night.state.data.awake)} />
              </InfoList>
            </Card>
          )}
          <WellnessNotice />
        </>
      )}
    </>
  )
}

export function WatchMetricPage() {
  const { metric } = useParams()
  const type = metricFromSlug(metric)
  return (
    <Page title={type ? metricLabels[type] : 'Relógio'} backTo={paths.watch} backLabel="Relógio">
      <DemoBanner />
      {type ? (
        <MetricBody key={type} type={type} />
      ) : (
        <EmptyState icon={Watch} title="Métrica desconhecida" />
      )}
    </Page>
  )
}
