import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, Pill } from 'lucide-react'
import { DocumentRow } from '@/components/domain/Documents'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { prescriptionStatus } from '@/lib/labels'
import { describeDuration, describeFrequency } from '@/lib/medication'
import { paths } from '@/routes/paths'
import { prescriptionService } from '@/services/prescription.service'
import type { MedicationPlan } from '@/types/medication'
import type { PrescriptionDetail } from '@/types/prescription'

type Closing = 'COMPLETED' | 'CANCELLED'

const closing: Record<Closing, { title: string; description: string; confirm: string; done: string }> = {
  COMPLETED: {
    title: 'Concluir receita?',
    description: 'Os medicamentos desta receita terminam e os lembretes param. O histórico de tomas mantém-se.',
    confirm: 'Concluir',
    done: 'Receita concluída.',
  },
  CANCELLED: {
    title: 'Cancelar receita?',
    description: 'Os medicamentos desta receita terminam e os lembretes param. O histórico de tomas mantém-se.',
    confirm: 'Cancelar receita',
    done: 'Receita cancelada.',
  },
}

/** Medicamento da receita: nome, dosagem, frequência, duração e observações. */
function MedicationRow({ plan }: { plan: MedicationPlan }) {
  return (
    <Link
      to={paths.medication(plan.id)}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-muted"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Pill className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">
          {plan.name} <span className="font-normal text-muted">{plan.dosage}</span>
        </span>
        <span className="text-sm text-muted">
          {describeFrequency(plan)} · {describeDuration(plan)}
        </span>
        {plan.notes && <span className="text-sm text-muted">{plan.notes}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}

interface PrescriptionContentProps {
  detail: PrescriptionDetail
  selfMemberId?: string
  onClose: (status: Closing) => void
}

function PrescriptionContent({ detail, selfMemberId, onClose }: PrescriptionContentProps) {
  const { prescription, memberName, medications, documents } = detail
  const status = prescriptionStatus[prescription.status]
  return (
    <>
      <InfoList>
        <InfoRow label="Médico" value={prescription.doctorName ?? 'Não indicado'} />
        {/* TBD: “Clínica” vem da especificação; o domínio não a tem na receita. */}
        <InfoRow label="Clínica" value={prescription.clinicName ?? 'Não indicada'} />
        <InfoRow label="Data" value={formatLongDate(prescription.issuedOn)} />
        {prescription.memberId !== selfMemberId && <InfoRow label="Para" value={memberName} />}
        <InfoRow
          label="Estado"
          value={
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          }
        />
      </InfoList>

      <DetailSection title="Medicamentos">
        <Card className="divide-y divide-border py-1">
          {medications.map((plan) => (
            <MedicationRow key={plan.id} plan={plan} />
          ))}
        </Card>
      </DetailSection>

      <DetailSection title="Documento original">
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

      {prescription.notes && (
        <DetailSection title="Observações">
          <Card>
            <p className="whitespace-pre-line">{prescription.notes}</p>
          </Card>
        </DetailSection>
      )}

      {prescription.status === 'ACTIVE' && (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="secondary" size="lg" onClick={() => onClose('COMPLETED')} className="sm:flex-1">
            Concluir receita
          </Button>
          <Button variant="danger-ghost" size="lg" onClick={() => onClose('CANCELLED')} className="sm:flex-1">
            Cancelar receita
          </Button>
        </div>
      )}
    </>
  )
}

export function PrescriptionDetailPage() {
  const { id = '' } = useParams()
  const { user, family, member } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => prescriptionService.getPrescription(familyId, userId, id),
    [familyId, userId, id],
  )
  const [confirming, setConfirming] = useState<Closing | null>(null)
  const [saving, setSaving] = useState(false)

  async function close(status: Closing) {
    setSaving(true)
    try {
      await prescriptionService.setPrescriptionStatus(familyId, userId, id, status)
      toast.show(closing[status].done)
      setConfirming(null)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title="Receita" backTo={paths.prescriptions} backLabel="Receitas">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Esta receita não existe ou não tem acesso a ela." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <PrescriptionContent detail={state.data} selfMemberId={member?.id} onClose={setConfirming} />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? closing[confirming].title : ''}
        description={confirming ? closing[confirming].description : undefined}
        confirmLabel={confirming ? closing[confirming].confirm : ''}
        destructive={confirming === 'CANCELLED'}
        loading={saving}
        onConfirm={() => confirming && close(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </Page>
  )
}
