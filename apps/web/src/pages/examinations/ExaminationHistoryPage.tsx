import { useParams } from 'react-router-dom'
import { ChartLine } from 'lucide-react'
import { TrendChart } from '@/components/domain/TrendChart'
import { Page } from '@/components/layout/Page'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isAppError } from '@/lib/errors'
import { formatReference, formatResultValue } from '@/lib/examination'
import { formatDayMonth, formatShortDate } from '@/lib/format'
import { paths } from '@/routes/paths'
import { examinationService } from '@/services/examination.service'
import type { ParameterHistory } from '@/types/examination'

/** Rótulo do eixo: o ano quando cada valor é de um ano diferente (como na especificação), senão “4 out 26”. */
function axisLabels(dates: string[]): string[] {
  const years = dates.map((d) => d.slice(0, 4))
  return new Set(years).size === years.length ? years : dates.map((d) => `${formatDayMonth(d)} ${d.slice(2, 4)}`)
}

function ParameterCard({ history }: { history: ParameterHistory }) {
  const numeric = history.points.filter((p) => p.result.valueNumeric !== undefined)
  const labels = axisLabels(numeric.map((p) => p.examDate))
  const latest = history.points.at(-1)?.result
  const reference = latest && formatReference(latest)

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">{history.parameter}</h2>
        {reference && <p className="text-sm text-muted">{reference} (último registo)</p>}
      </div>
      {numeric.length > 1 && (
        <TrendChart
          label={`Evolução de ${history.parameter}: ${numeric
            .map((p) => `${formatShortDate(p.examDate)} ${formatResultValue(p.result)}`)
            .join(', ')}`}
          points={numeric.map((p, i) => ({ label: labels[i] ?? '', value: p.result.valueNumeric ?? 0 }))}
        />
      )}
      <ul className="divide-y divide-border">
        {[...history.points].reverse().map(({ examDate, result }) => (
          <li key={result.id} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-muted">{formatShortDate(examDate)}</span>
            <span className="font-medium tabular-nums">{formatResultValue(result)}</span>
          </li>
        ))}
      </ul>
      {history.points.length === 1 && (
        <p className="text-sm text-muted">Só existe um registo; a evolução aparece a partir do segundo.</p>
      )}
    </Card>
  )
}

/** Histórico dos resultados do exame ao longo do tempo (tendência simples, sem interpretação). */
export function ExaminationHistoryPage() {
  const { id = '' } = useParams()
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => examinationService.getParameterHistory(familyId, userId, id),
    [familyId, userId, id],
  )

  return (
    <Page title="Histórico de resultados" backTo={paths.examination(id)} backLabel="Exame">
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este exame não existe ou não tem acesso a ele." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' &&
        (state.data.length > 0 ? (
          <>
            {state.data.map((history) => (
              <ParameterCard key={history.parameter} history={history} />
            ))}
            <p className="text-sm text-muted">
              Valores tal como foram registados, do mais recente para o mais antigo. Sem interpretação médica.
            </p>
          </>
        ) : (
          <EmptyState icon={ChartLine} title="Este exame não tem resultados." />
        ))}
    </Page>
  )
}
