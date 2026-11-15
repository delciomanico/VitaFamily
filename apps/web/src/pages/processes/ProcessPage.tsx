import { useParams } from 'react-router-dom'
import { CircleSlash, ShieldCheck } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isAppError } from '@/lib/errors'
import { formatLongDate, formatWhen } from '@/lib/format'
import { coverageText, nextStepSentence, processStatusLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { processService } from '@/services/process.service'
import type { FamilyProcess } from '@/types/process'

/**
 * Cartão do processo (fatia 5, ADR-036; process-flows.md §14): o estado, o que falta e, para o titular/tutor, como está o
 * pedido à seguradora. Só códigos da API traduzidos aqui; nunca motivo, valor, serviço nem decisor (BR-PRC-12).
 * Inexistente ou sem acesso (404, sem enumeração) ⇒ «já não está disponível».
 */
export function ProcessPage() {
  const { family, user } = useAuth()
  const { memberId = '', processId = '' } = useParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => processService.getProcess(familyId, userId, memberId, processId),
    [familyId, userId, memberId, processId],
  )

  return (
    <Page title="Processo" backTo={paths.alerts} backLabel="Alertas">
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <EmptyState
            icon={CircleSlash}
            title="Este processo já não está disponível."
            description="Pode ter sido concluído ou removido."
            action={
              <ButtonLink to={paths.alerts} variant="soft" size="sm">
                Voltar aos alertas
              </ButtonLink>
            }
          />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && <ProcessCard process={state.data} />}
    </Page>
  )
}

function ProcessCard({ process }: { process: FamilyProcess }) {
  const status = processStatusLabels[process.familyStatus] ?? { label: 'A tratar', tone: 'neutral' as const }
  const coverage = process.coverage ? coverageText(process.coverage, formatLongDate) : undefined
  const origin =
    process.origin.type === 'APPOINTMENT'
      ? { to: paths.appointment(process.origin.id), label: 'Ver consulta' }
      : process.origin.type === 'EXAMINATION'
        ? { to: paths.examination(process.origin.id), label: 'Ver exame' }
        : undefined

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {process.scheduledAt && <span className="text-sm text-muted">{formatWhen(process.scheduledAt)}</span>}
        </div>
        <p className="font-medium">{nextStepSentence(process.nextStep, formatLongDate)}</p>
      </Card>
      {coverage && (
        <DetailSection title="Seguro">
          <Card className="flex items-start gap-3" data-testid="coverage-block">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="flex flex-col gap-1">
              <p>{coverage.headline}</p>
              {coverage.hint && <p className="text-sm text-muted">{coverage.hint}</p>}
            </div>
          </Card>
        </DetailSection>
      )}
      {origin && (
        <ButtonLink to={origin.to} variant="soft">
          {origin.label}
        </ButtonLink>
      )}
    </div>
  )
}
