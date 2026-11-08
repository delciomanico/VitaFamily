import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { todayISO } from '@/lib/date'
import { formatDayMonth } from '@/lib/format'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicDayService } from '@/services/clinicDay.service'
import type { ClinicReportSummary } from '@/types/clinic'

type Period = '7' | '30' | '90'

const periods = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
] as const

/** Taxa 0..1 → "42 %"; nula (sem denominador) → "–". */
function formatRate(rate: number | null | undefined): string {
  return rate == null ? '–' : `${Math.round(rate * 100)} %`
}

/** Dia local yyyy-mm-dd, `days` dias antes de hoje. */
function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return todayISO(date)
}

/** Barra simples em CSS (0..1); sem biblioteca de gráficos. */
function Bar({ value, tone = 'bg-primary' }: { value: number | null; tone?: string }) {
  const percent = value == null ? 0 : Math.min(100, Math.round(value * 100))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  bar,
  barTone,
}: {
  label: string
  value: string | number
  hint?: string
  bar?: number | null
  barTone?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl leading-tight font-semibold tabular-nums">{value}</p>
      {bar !== undefined && <Bar value={bar} tone={barTone} />}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

function Summary({ report }: { report: ClinicReportSummary }) {
  const { totals, byProfessional } = report
  const empty = totals.slotsTotal === 0 && totals.completed + totals.noShows + totals.cancellations === 0
  return (
    <>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat
          label="Ocupação"
          value={formatRate(totals.occupancyRate)}
          bar={totals.occupancyRate}
          hint={`${totals.slotsBooked} de ${totals.slotsTotal} vagas`}
        />
        <Stat label="Consultas realizadas" value={totals.completed} />
        <Stat
          label="Faltas"
          value={totals.noShows}
          bar={totals.noShowRate}
          barTone="bg-warning"
          hint={`Taxa de faltas: ${formatRate(totals.noShowRate)}`}
        />
        <Stat label="Cancelamentos" value={totals.cancellations} />
        <Stat label="“Não posso”" value={totals.declinedByPatient} hint="Pacientes que recusaram na app" />
        <Stat label="Novos pacientes" value={totals.newPatients} />
        <Stat label="Exames concluídos" value={totals.examsCompleted} />
      </section>

      <DetailSection title="Por profissional">
        {byProfessional.length > 0 && !empty ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium">Profissional</th>
                  <th className="px-3 py-3 font-medium">Ocupação</th>
                  <th className="px-3 py-3 text-right font-medium">Realizadas</th>
                  <th className="px-3 py-3 text-right font-medium">Faltas</th>
                  <th className="px-3 py-3 text-right font-medium">Taxa</th>
                  <th className="px-4 py-3 text-right font-medium">Cancel.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byProfessional.map((row) => (
                  <tr key={row.professionalId ?? 'none'}>
                    <td className="px-4 py-3 font-medium">{row.professionalName ?? 'Sem profissional'}</td>
                    <td className="w-40 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Bar value={row.occupancyRate} />
                        <span className="w-10 shrink-0 text-right tabular-nums">{formatRate(row.occupancyRate)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.completed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.noShows}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatRate(row.noShowRate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.cancellations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptyState icon={BarChart3} title="Sem dados neste período." description="Publique horários e registe consultas para ver os indicadores." />
        )}
      </DetailSection>
    </>
  )
}

/**
 * Relatórios simples (M14 Q, BR-CLN-29, UC-CLN-24): só contagens e taxas por período e, se se
 * quiser, por profissional. Nunca nomes de pacientes. Barras em CSS, sem gráficos pesados.
 */
export function ClinicReportsPage() {
  const [period, setPeriod] = useState<Period>('30')
  const [professionalId, setProfessionalId] = useState('')
  const professionals = useAsync(() => clinicCatalogService.listProfessionals({}), [])
  const { state, reload } = useAsync(
    () =>
      clinicDayService.getReportSummary({
        from: daysAgo(Number(period) - 1),
        to: todayISO(),
        professionalId: professionalId || undefined,
      }),
    [period, professionalId],
  )
  const list = professionals.state.status === 'success' ? professionals.state.data : []

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Relatórios</h1>
        {state.status === 'success' && (
          <p className="text-sm text-muted">
            {formatDayMonth(state.data.from)} – {formatDayMonth(state.data.to)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Tabs
          label="Período"
          value={period}
          onChange={setPeriod}
          items={periods.map((p) => ({ value: p.value, label: p.label }))}
          className="w-72"
        />
        <div className="min-w-44 flex-1 sm:max-w-64">
          <Select
            label="Profissional"
            value={professionalId}
            placeholder="Todos os profissionais"
            options={list.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(event) => setProfessionalId(event.target.value)}
          />
        </div>
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <Summary report={state.data} />}
    </>
  )
}
