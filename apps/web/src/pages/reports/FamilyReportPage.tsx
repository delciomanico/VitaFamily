import { Lock } from 'lucide-react'
import { PendingList } from '@/components/domain/ReportParts'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { RowLink } from '@/components/ui/RowLink'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { ageOn } from '@/lib/date'
import { formatAge, formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import { reportService } from '@/services/report.service'
import type { FamilyReport, FamilyReportMember } from '@/types/report'

/** Resumo do que se vê de um membro (só o que existe): “2 medicamentos · 1 consulta · Alergias: Penicilina”. */
function memberSummary(row: FamilyReportMember): string {
  const count = (items: unknown[] | undefined, singular: string, plural: string) =>
    items?.length ? formatCount(items.length, singular, plural) : null
  const parts = [
    count(row.activeMedications, 'medicamento', 'medicamentos'),
    count(row.upcomingAppointments, 'consulta', 'consultas'),
    count(row.upcomingExaminations, 'exame', 'exames'),
    row.allergies?.length ? `Alergias: ${row.allergies.join(', ')}` : null,
    row.conditions?.length ? `Condições: ${row.conditions.join(', ')}` : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function MemberRow({ row }: { row: FamilyReportMember }) {
  const { member, isSelf, manage, pending } = row
  const summary = memberSummary(row)
  return (
    <RowLink to={paths.preventiveReportOf(member.id)}>
      <Avatar name={member.name} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">
          {member.name}
          {isSelf && <span className="font-normal text-muted"> (eu)</span>}
        </span>
        <span className="line-clamp-2 text-sm text-muted">
          {formatAge(ageOn(member.birthDate))}
          {summary && ` · ${summary}`}
        </span>
        <span className="mt-0.5">
          {!manage ? (
            <Badge tone="neutral">
              <Lock className="size-3" aria-hidden />
              Só o que partilha
            </Badge>
          ) : pending.length > 0 ? (
            <Badge tone="warning" dot>
              {formatCount(pending.length, 'pendente', 'pendentes')}
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Em dia
            </Badge>
          )}
        </span>
      </span>
    </RowLink>
  )
}

/** Totais das próximas consultas, exames, medicamentos ativos e pendentes visíveis. */
function Totals({ report }: { report: FamilyReport }) {
  const sum = (pick: (row: FamilyReportMember) => unknown[] | undefined) =>
    report.members.reduce((total, row) => total + (pick(row)?.length ?? 0), 0)
  const totals = [
    { label: 'Consultas', value: sum((r) => r.upcomingAppointments), hint: 'próximas' },
    { label: 'Exames', value: sum((r) => r.upcomingExaminations), hint: 'agendados' },
    { label: 'Medicamentos', value: sum((r) => r.activeMedications), hint: 'ativos' },
    { label: 'Pendentes', value: sum((r) => r.pending), hint: 'por atualizar' },
  ]
  return (
    <Card className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
      {totals.map(({ label, value, hint }) => (
        <div key={label} className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted">{hint}</span>
        </div>
      ))}
    </Card>
  )
}

function ReportContent({ report }: { report: FamilyReport }) {
  const managed = report.members.filter((r) => r.manage)
  const withPending = managed.filter((r) => r.pending.length > 0).length
  const pending = report.members.flatMap((r) => r.pending).sort((a, b) => b.date.localeCompare(a.date))
  const nameOf = (id: string) => report.members.find((r) => r.member.id === id)?.member.name ?? ''
  const manages = (id: string) => managed.some((r) => r.member.id === id)

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{report.family.name}</h2>
        <p className="text-muted">{formatCount(report.familySize, 'membro', 'membros')}</p>
        <p className="flex flex-wrap gap-2 pt-1">
          <Badge tone="success" dot>
            {managed.length - withPending} em dia
          </Badge>
          {withPending > 0 && (
            <Badge tone="warning" dot>
              {withPending} com acompanhamento pendente
            </Badge>
          )}
        </p>
      </div>

      <Totals report={report} />

      <DetailSection title="Membros">
        <Card className="divide-y divide-border py-1">
          {report.members.map((row) => (
            <MemberRow key={row.member.id} row={row} />
          ))}
        </Card>
      </DetailSection>

      {pending.length > 0 && (
        <DetailSection title="Pendentes">
          <PendingList items={pending} memberNameOf={nameOf} canOpen={manages} />
        </DetailSection>
      )}

      <p className="text-sm text-muted">
        Inclui só o que pode ver: tudo de si e dos seus dependentes; dos outros adultos, o que partilham consigo.
      </p>
    </>
  )
}

/** Saúde da família (UC-RPT-02): membros visíveis, totais e pendentes. */
export function FamilyReportPage() {
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => reportService.getFamilyReport(familyId, userId), [familyId, userId])

  return (
    <Page title="Saúde da família" backTo={paths.home} backLabel="Início">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <ReportContent report={state.data} />}
    </Page>
  )
}
