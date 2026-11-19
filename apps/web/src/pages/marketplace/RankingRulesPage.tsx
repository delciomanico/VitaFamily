import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Card, Section } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { rankingSignalLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { marketplaceService } from '@/services/marketplace.service'
import type { RankingRules } from '@/types/marketplace'

/** Regras públicas da ordenação «Melhores» (`/marketplace/como-ordenamos`). */
export function RankingRulesPage() {
  usePageTitle('Como ordenamos')
  const { state, reload } = useAsync(() => marketplaceService.rankingRules(), [])

  return (
    <Page title="Como ordenamos" backTo={paths.marketplace}>
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      {state.status === 'success' && <RulesContent rules={state.data} />}
    </Page>
  )
}

function RulesContent({ rules }: { rules: RankingRules }) {
  return (
    <>
      <p className="rounded-xl bg-primary-soft p-4 font-medium text-primary">{rules.statement}</p>

      <Section title="Critérios">
        <Card className="py-1">
          <ul className="divide-y divide-border">
            {rules.signals.map((signal) => (
              <li key={signal.code} className="flex flex-col gap-1 py-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{rankingSignalLabel[signal.code]}</span>
                  <Badge tone="primary">{signal.weightPercent}%</Badge>
                </span>
                <span className="text-sm text-muted">{signal.description}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="O que nunca influencia a ordem">
        <Card>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {rules.notUsed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </Section>
    </>
  )
}
