import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppointmentList } from '@/components/domain/AppointmentList'
import { ExaminationList } from '@/components/domain/ExaminationList'
import { TagList } from '@/components/domain/HealthProfileView'
import { MedicationList } from '@/components/domain/MedicationList'
import { PrescriptionList } from '@/components/domain/PrescriptionList'
import { FollowUpList, PendingList, ReportDisclaimer } from '@/components/domain/ReportParts'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Select } from '@/components/ui/Select'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { ageOn, monthsBefore, todayISO } from '@/lib/date'
import { isAppError } from '@/lib/errors'
import { formatAge, formatCount, formatShortDate } from '@/lib/format'
import { bloodTypeLabel, relationshipLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { reportService } from '@/services/report.service'
import type { AdherenceItem, MemberReport } from '@/types/report'

/** Períodos à escolha (BR-RPT-02: 12 meses por defeito, máximo 5 anos). */
type Months = '3' | '12' | '60'

const periods: TabItem<Months>[] = [
  { value: '3', label: '3 meses' },
  { value: '12', label: '12 meses' },
  { value: '60', label: '5 anos' },
]

/** Itens mostrados de cada lista antes de “Ver mais” (listas paginadas, BR-RPT-02). */
const PAGE_SIZE = 5

/** Lista com “Ver mais”: mostra PAGE_SIZE de cada vez. */
function Paged<T>({ items, empty, render }: { items: T[]; empty: string; render: (items: T[]) => ReactNode }) {
  const [shown, setShown] = useState(PAGE_SIZE)
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <>
      {render(items.slice(0, shown))}
      {items.length > shown && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown((n) => n + PAGE_SIZE)}>
          Ver mais ({items.length - shown})
        </Button>
      )}
    </>
  )
}

/** “10 tomadas · 1 não tomada · 2 não confirmadas”: só contagens (UC-RPT-03). */
function adherenceText(item: AdherenceItem): string {
  const parts = [
    item.taken && formatCount(item.taken, 'tomada', 'tomadas'),
    item.notTaken && formatCount(item.notTaken, 'não tomada', 'não tomadas'),
    item.unconfirmed && formatCount(item.unconfirmed, 'não confirmada', 'não confirmadas'),
    item.pending && formatCount(item.pending, 'por tomar', 'por tomar'),
  ]
  return parts.filter(Boolean).join(' · ')
}

function ReportContent({ report }: { report: MemberReport }) {
  const { member, manage, categories } = report
  const can = (category: (typeof categories)[number]) => categories.includes(category)
  const details = [
    member.relationship && member.relationship !== 'SELF' ? relationshipLabels[member.relationship] : null,
    formatAge(ageOn(member.birthDate)),
  ]
  const conditions = report.conditions?.filter((c) => c.kind === 'CONDITION').map((c) => c.name) ?? []
  const history = report.conditions?.filter((c) => c.kind === 'HISTORY').map((c) => c.name) ?? []

  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={member.name} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">
            {member.name}
            {report.isSelf && <span className="font-normal text-muted"> (eu)</span>}
          </p>
          <p className="text-muted">{details.filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted">
            {formatShortDate(report.from)} – {formatShortDate(report.to)}
          </p>
        </div>
      </div>

      {!manage && (
        <p className="text-sm text-muted">Inclui só as categorias que {member.name.split(' ')[0]} partilha consigo.</p>
      )}

      {(can('APPOINTMENTS') || can('EXAMS') || can('MEDICATION')) && (
        <DetailSection title="Acompanhamento">
          <FollowUpList categories={categories} pending={report.pending} />
        </DetailSection>
      )}

      {report.pending.length > 0 && (
        <DetailSection title="Pendentes">
          <PendingList items={report.pending} canOpen={() => manage} />
        </DetailSection>
      )}

      {(can('ALLERGIES') || can('CONDITIONS')) && (
        <DetailSection title="Saúde">
          {can('ALLERGIES') && (
            <InfoList>
              <InfoRow
                label="Tipo sanguíneo"
                value={report.bloodType ? bloodTypeLabel(report.bloodType) : 'Não indicado'}
              />
            </InfoList>
          )}
          {can('ALLERGIES') && (
            <Card className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Alergias</h3>
              <TagList items={report.allergies ?? []} empty="Nenhuma alergia registada." />
            </Card>
          )}
          {can('CONDITIONS') && (
            <Card className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Condições</h3>
              <TagList items={conditions} empty="Nenhuma condição registada." />
              <h3 className="pt-2 text-sm font-medium">Histórico</h3>
              <TagList items={history} empty="Nenhum antecedente registado." />
            </Card>
          )}
        </DetailSection>
      )}

      {can('MEDICATION') && (
        <>
          <DetailSection title="Medicamentos ativos">
            <Paged
              items={report.medications ?? []}
              empty="Sem medicamentos ativos."
              render={(items) => <MedicationList items={items} selfMemberId={member.id} linked={manage} />}
            />
          </DetailSection>
          {(report.adherence?.length ?? 0) > 0 && (
            <DetailSection title="Tomas no período">
              <Card className="divide-y divide-border py-1">
                {report.adherence?.map((item) => (
                  <div key={item.planId} className="flex flex-col gap-0.5 py-3">
                    <span className="font-medium">{item.medicationName}</span>
                    <span className="text-sm text-muted">{adherenceText(item)}</span>
                  </div>
                ))}
              </Card>
            </DetailSection>
          )}
          <DetailSection title="Receitas">
            <Paged
              items={report.prescriptions ?? []}
              empty="Sem receitas no período."
              render={(items) => <PrescriptionList items={items} selfMemberId={member.id} linked={manage} />}
            />
          </DetailSection>
        </>
      )}

      {can('APPOINTMENTS') && (
        <DetailSection title="Consultas">
          <Paged
            items={report.appointments ?? []}
            empty="Sem consultas no período."
            render={(items) => <AppointmentList items={items} selfMemberId={member.id} linked={manage} />}
          />
        </DetailSection>
      )}

      {can('EXAMS') && (
        <DetailSection title="Exames">
          <Paged
            items={report.examinations ?? []}
            empty="Sem exames no período."
            render={(items) => <ExaminationList items={items} selfMemberId={member.id} linked={manage} />}
          />
        </DetailSection>
      )}

      <ReportDisclaimer />
    </>
  )
}

/** Relatório preventivo (UC-RPT-01): resumo de um membro num período, só com o que pode ver. */
export function PreventiveReportPage() {
  const { user, family, member: self } = useAuth()
  const [params, setParams] = useSearchParams()
  const [months, setMonths] = useState<Months>('12')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const memberId = params.get('membro') ?? self?.id ?? ''

  const subjects = useAsync(() => reportService.listReportSubjects(familyId, userId), [familyId, userId])
  const { state, reload } = useAsync(() => {
    const to = todayISO()
    return reportService.getMemberReport(familyId, userId, memberId, { from: monthsBefore(to, Number(months)), to })
  }, [familyId, userId, memberId, months])

  const options =
    subjects.state.status === 'success'
      ? subjects.state.data.map(({ member, isSelf }) => ({
          value: member.id,
          label: isSelf ? `${member.name} (eu)` : member.name,
        }))
      : []

  return (
    <Page title="Relatório preventivo" backTo={paths.familyReport} backLabel="Saúde da família">
      {options.length > 1 && (
        <Select
          label="Membro"
          options={options}
          value={memberId}
          onChange={(event) => setParams({ membro: event.target.value }, { replace: true })}
        />
      )}
      <Tabs label="Período" items={periods} value={months} onChange={setMonths} />
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Não há relatório disponível para este membro." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && <ReportContent key={`${memberId}-${months}`} report={state.data} />}
    </Page>
  )
}
