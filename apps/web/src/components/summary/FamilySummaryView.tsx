import { Link } from 'react-router-dom'
import { ChevronRight, Users } from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import { Avatar } from '@/components/ui/Avatar'
import { firstName } from '@/lib/date'
import { formatCount, formatShortDate } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { FamilyHealthSummary, FamilyHealthSummaryMember } from '@/types/healthSummary'
import { AiExtensionPoint } from './MemberSummaryView'
import { EmptyNote } from './SummaryParts'

function memberLine(m: FamilyHealthSummaryMember): string {
  return [
    m.activeMedications ? formatCount(m.activeMedications, 'medicamento', 'medicamentos') : null,
    m.upcoming30d ? `${m.upcoming30d} a seguir` : null,
    m.missingCount ? `${m.missingCount} por registar` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function activityLine(m: FamilyHealthSummaryMember): string {
  const a = m.activity
  if (!a) return 'Sem atividade'
  return [
    a.prescriptions !== undefined && formatCount(a.prescriptions, 'receita', 'receitas'),
    a.appointments !== undefined && formatCount(a.appointments, 'consulta', 'consultas'),
    a.exams !== undefined && formatCount(a.exams, 'exame', 'exames'),
    a.dosesConfirmed !== undefined && formatCount(a.dosesConfirmed, 'toma confirmada', 'tomas confirmadas'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Resumo da família: um bloco por membro visível; tocar abre o resumo desse membro. */
export function FamilySummaryView({ summary, linkTo }: { summary: FamilyHealthSummary; linkTo: (memberId: string) => string }) {
  if (summary.members.length === 0) return <EmptyNote title="Ainda não há ninguém para mostrar" description="Aqui aparecem os membros da família e o que partilham consigo." />
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {summary.members.map((m) => (
          <li key={m.memberId}>
            <Link to={linkTo(m.memberId)} className="flex items-center gap-4 rounded-2xl active:bg-surface-muted">
              <Avatar name={m.displayName} size="lg" />
              <span className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 border-b border-border py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-display text-lg leading-6 font-semibold">{firstName(m.displayName)}</span>
                  <span className="text-sm text-muted">{memberLine(m) || 'Ver resumo'}</span>
                </span>
                {m.adherencePct !== undefined && (
                  <span className="flex flex-col items-end leading-tight">
                    <span className="text-xl font-bold text-primary tabular-nums" aria-label={m.adherencePct === null ? 'Sem tomas no período' : undefined}>{m.adherencePct === null ? '—' : `${m.adherencePct} %`}</span>
                    <span className="text-xs text-muted">tomas</span>
                  </span>
                )}
                <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <AccordionSection title="Atividade no período" icon={Users} tone="family" summary="Quem registou o quê">
        <ul className="flex flex-col">
          {summary.members.map((m) => (
            <li key={m.memberId} className="flex flex-col gap-0.5 border-b border-border py-3 last:border-b-0">
              <span className="text-base font-medium">{firstName(m.displayName)}</span>
              <span className="text-sm text-muted">{activityLine(m)}</span>
              {m.activity?.lastActivityOn && <span className="text-sm text-muted">Último registo: {formatShortDate(m.activity.lastActivityOn)}</span>}
            </li>
          ))}
        </ul>
      </AccordionSection>
      <AiExtensionPoint />
      <p className="text-sm text-muted">
        De {formatShortDate(summary.period.from)} a {formatShortDate(summary.period.to)}. Só vê de cada pessoa o que ela partilha consigo. <Link className="font-semibold text-primary" to={paths.familyReport}>Saúde da família</Link>
      </p>
    </div>
  )
}
