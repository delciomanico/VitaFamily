import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChartLine } from 'lucide-react'
import { DocumentRow } from '@/components/domain/Documents'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatReference, formatResultValue } from '@/lib/examination'
import { formatLongDate } from '@/lib/format'
import { examinationStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { examinationService } from '@/services/examination.service'
import type { ExamResult, ExaminationDetail } from '@/types/examination'

/** Parâmetro, valor e a referência indicada pelo utilizador — sem “dentro/fora” (BR-EXM-02). */
function ResultRow({ result }: { result: ExamResult }) {
  const reference = formatReference(result)
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{result.parameter}</p>
        {reference && <p className="text-sm text-muted">{reference}</p>}
      </div>
      <p className="shrink-0 text-right font-semibold tabular-nums">{formatResultValue(result)}</p>
    </div>
  )
}

interface ExaminationContentProps {
  detail: ExaminationDetail
  selfMemberId?: string
  onComplete: () => void
  onCancel: () => void
  completing: boolean
}

function ExaminationContent({ detail, selfMemberId, onComplete, onCancel, completing }: ExaminationContentProps) {
  const { examination, memberName, results, documents } = detail
  const status = examinationStatus[examination.status]
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{examination.name}</h2>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        {examination.memberId !== selfMemberId && <p className="text-muted">{memberName}</p>}
      </div>

      <InfoList>
        <InfoRow label="Data" value={formatLongDate(examination.examDate)} />
        <InfoRow label="Clínica/Laboratório" value={examination.clinicName ?? 'Não indicado'} />
      </InfoList>

      {examination.status === 'COMPLETED' && (
        <DetailSection
          title="Resultados"
          action={
            results.length > 0 && (
              <ButtonLink
                to={paths.examinationHistory(examination.id)}
                variant="soft"
                size="sm"
                icon={<ChartLine className="size-4" aria-hidden />}
              >
                Ver histórico
              </ButtonLink>
            )
          }
        >
          {results.length > 0 ? (
            <Card className="divide-y divide-border py-0">
              {results.map((result) => (
                <ResultRow key={result.id} result={result} />
              ))}
            </Card>
          ) : (
            <p className="text-sm text-muted">Sem resultados registados.</p>
          )}
          {results.length > 0 && (
            <p className="text-sm text-muted">
              Os valores e as referências são os indicados no registo. A Vita Family não interpreta resultados; fale com
              o seu médico.
            </p>
          )}
        </DetailSection>
      )}

      <DetailSection title="Documento">
        {documents.length > 0 ? (
          <Card className="divide-y divide-border py-0">
            {documents.map((doc) => (
              <DocumentRow key={doc.id} document={doc} />
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">Nenhum documento anexado.</p>
        )}
      </DetailSection>

      {examination.notes && (
        <DetailSection title="Observações">
          <Card>
            <p className="whitespace-pre-line">{examination.notes}</p>
          </Card>
        </DetailSection>
      )}

      {examination.status === 'SCHEDULED' && (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="secondary" size="lg" onClick={onComplete} loading={completing} className="sm:flex-1">
            Marcar como realizado
          </Button>
          <Button variant="danger-ghost" size="lg" onClick={onCancel} className="sm:flex-1">
            Cancelar exame
          </Button>
        </div>
      )}
    </>
  )
}

/** Detalhe do exame: dados, resultados, documento e histórico de resultados. */
export function ExaminationDetailPage() {
  const { id = '' } = useParams()
  const { user, family, member } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => examinationService.getExamination(familyId, userId, id),
    [familyId, userId, id],
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState<'COMPLETED' | 'CANCELLED' | null>(null)

  async function setStatus(status: 'COMPLETED' | 'CANCELLED') {
    setSaving(status)
    try {
      await examinationService.setExaminationStatus(familyId, userId, id, status)
      toast.show(status === 'COMPLETED' ? 'Exame marcado como realizado.' : 'Exame cancelado.')
      setConfirming(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Page title="Exame" backTo={paths.examinations} backLabel="Exames">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este exame não existe ou não tem acesso a ele." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <ExaminationContent
          detail={state.data}
          selfMemberId={member?.id}
          onComplete={() => setStatus('COMPLETED')}
          onCancel={() => setConfirming(true)}
          completing={saving === 'COMPLETED'}
        />
      )}

      <ConfirmDialog
        open={confirming}
        title="Cancelar exame?"
        description="O exame fica no histórico como cancelado."
        confirmLabel="Cancelar exame"
        destructive
        loading={saving === 'CANCELLED'}
        onConfirm={() => setStatus('CANCELLED')}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  )
}
