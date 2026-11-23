import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarDays, ChevronRight, ClipboardCheck, FileText, FlaskConical, Pill, Sparkles } from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import { Badge } from '@/components/ui/Badge'
import { formatCount, formatShortDate } from '@/lib/format'
import { alertGroups, formatMonth, formatNumber, formatVariation, missingRow, statusCount } from '@/lib/summaryText'
import { paths } from '@/routes/paths'
import type { ExamParameterSeries, HealthSummary } from '@/types/healthSummary'
import { AdherenceBars } from './AdherenceBars'
import { ExamSeriesSheet } from './ExamSeriesSheet'
import { LineChart } from './LineChart'
import { EmptyNote, StatRow, TextLink } from './SummaryParts'

interface Props {
  summary: HealthSummary
  /** Nome próprio, para frases como «Maria ainda não tem…». */
  firstName: string
  /** Pode adicionar registos (próprio ou dependente): só então se oferecem ações de adicionar. */
  canAdd: boolean
}

function AdherenceHero({ medication, firstName, canAdd }: { medication: NonNullable<HealthSummary['medication']>; firstName: string; canAdd: boolean }) {
  const { overall, series, granularity } = medication
  const pct = overall.adherencePct
  const buckets = series.filter((b) => b.adherencePct !== null)
  const last = buckets[buckets.length - 1]
  const before = buckets[buckets.length - 2]
  // Tendência: só a diferença aritmética entre os dois últimos períodos (sem «melhorou/piorou»).
  const diff = last && before ? (last.adherencePct as number) - (before.adherencePct as number) : null
  const unit = granularity === 'WEEK' ? 'semana' : 'mês'
  const counts = [
    overall.taken > 0 && formatCount(overall.taken, 'tomada', 'tomadas'),
    overall.notTaken > 0 && formatCount(overall.notTaken, 'não tomada', 'não tomadas'),
    overall.unconfirmed > 0 && formatCount(overall.unconfirmed, 'por confirmar', 'por confirmar'),
  ].filter(Boolean)
  return (
    <section aria-labelledby="adherence-title" className="flex flex-col gap-3 border-b border-border pb-5">
      <h2 id="adherence-title" className="text-base font-medium text-muted">
        Medicamentos tomados
      </h2>
      {pct === null ? (
        <EmptyNote
          title="Ainda não há tomas neste período"
          description={`Quando ${firstName} confirmar as tomas, aqui vê a percentagem.`}
          actionLabel={canAdd ? 'Ver medicamentos' : undefined}
          to={canAdd ? paths.medications : undefined}
        />
      ) : (
        <>
          <p className="font-display text-7xl leading-none font-bold tracking-tight text-primary">
            {pct}
            <span className="ms-1 text-4xl">%</span>
          </p>
          <p className="text-base">das tomas do período foram confirmadas como tomadas.</p>
          {counts.length > 0 && <p className="text-sm text-muted">{counts.join(' · ')}</p>}
          {diff !== null && (
            <p className="text-sm text-muted">
              {diff === 0 ? `Igual ao ${unit} anterior` : `${formatVariation(diff)} ${Math.abs(diff) === 1 ? 'ponto' : 'pontos'} face ao ${unit} anterior`}
            </p>
          )}
          <AdherenceBars series={series} granularity={granularity} />
        </>
      )}
    </section>
  )
}

function MedicationSection({ medication }: { medication: NonNullable<HealthSummary['medication']> }) {
  const items = medication.byMedication
  return (
    <AccordionSection title="Por medicamento" icon={Pill} tone="meds" summary={items.length ? formatCount(items.length, 'medicamento', 'medicamentos') : 'Sem tomas no período'}>
      {items.length === 0 ? (
        <EmptyNote title="Ainda não há tomas neste período" />
      ) : (
        <ul className="flex flex-col">
          {items.map((m) => (
            <li key={m.planId}>
              <StatRow
                label={m.medicationName}
                value={m.adherencePct === null ? '—' : `${m.adherencePct} %`}
                hint={[
                  m.taken > 0 && formatCount(m.taken, 'tomada', 'tomadas'),
                  m.notTaken > 0 && formatCount(m.notTaken, 'não tomada', 'não tomadas'),
                  m.unconfirmed > 0 && `${m.unconfirmed} por confirmar`,
                  m.pending > 0 && `${m.pending} por vir`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </li>
          ))}
        </ul>
      )}
    </AccordionSection>
  )
}

function ExamsSection({ exams, canAdd, onOpen }: { exams: NonNullable<HealthSummary['exams']>; canAdd: boolean; onOpen: (s: ExamParameterSeries) => void }) {
  const { series } = exams
  return (
    <AccordionSection title="Valores dos exames" icon={FlaskConical} tone="brand" summary={series.length ? formatCount(series.length, 'valor acompanhado', 'valores acompanhados') : 'Ainda não há exames'}>
      {series.length === 0 ? (
        <EmptyNote
          title="Ainda não há exames neste período"
          description="Com resultados registados, aqui vê como cada valor foi mudando."
          actionLabel={canAdd ? 'Adicionar exame' : undefined}
          to={canAdd ? paths.examinationNew : undefined}
        />
      ) : (
        <>
          <ul className="flex flex-col">
            {series.map((s) => {
              const pct = formatVariation(s.variationPct, ' %')
              return (
                <li key={`${s.parameter}|${s.unit}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(s)}
                    aria-label={`${s.parameter}${s.unit ? ` (${s.unit})` : ''}, ver detalhe`}
                    className="flex w-full items-center gap-3 border-b border-border py-3 text-start"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-base font-medium">
                        {s.parameter}
                        {s.unit && <span className="font-normal text-muted"> ({s.unit})</span>}
                      </span>
                      <span className="text-sm text-muted">
                        {s.count === 1 ? 'Último valor' : `${s.count} medições · último`}: <span className="font-semibold text-foreground">{formatNumber(s.last)}</span>
                        {pct && <> · {pct}</>}
                      </span>
                    </span>
                    {s.count > 1 && (
                      <span className="w-20 shrink-0" aria-hidden>
                        <LineChart compact points={s.points} label="" />
                      </span>
                    )}
                    <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
          {exams.truncated && <p className="text-sm text-muted">Mostramos os valores com medições mais recentes.</p>}
        </>
      )}
    </AccordionSection>
  )
}

function CountsList({ byStatus, byMonth, upcoming30d, upcomingLabel }: { byStatus: Record<string, number>; byMonth: Array<{ month: string; count: number }>; upcoming30d: number; upcomingLabel: string }) {
  const statuses = Object.entries(byStatus)
  return (
    <div className="flex flex-col">
      {statuses.length === 0 ? <p className="py-2 text-base text-muted">Nenhum neste período.</p> : statuses.map(([status, count]) => <StatRow key={status} label={statusCount(status, 2).replace(/^\d+ /, '').replace(/^./, (c) => c.toUpperCase())} value={count} />)}
      <StatRow label={upcomingLabel} value={upcoming30d} hint="Nos próximos 30 dias" />
      {byMonth.length > 0 && (
        <p className="pt-2 text-sm text-muted">
          Por mês: {byMonth.map((m) => `${formatMonth(m.month)} (${m.count})`).join(', ')}
        </p>
      )}
    </div>
  )
}

function MissingSection({ missing }: { missing: NonNullable<HealthSummary['missing']> }) {
  const rows = missing.map(missingRow)
  return (
    <AccordionSection title="O que falta registar" icon={ClipboardCheck} tone="family" summary={rows.length ? formatCount(rows.length, 'ponto por completar', 'pontos por completar') : 'Está tudo completo'}>
      {rows.length === 0 ? (
        <p className="text-base text-muted">Não falta nada do que já registou. Bom trabalho!</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.text} className="border-b border-border last:border-b-0">
              {row.to ? (
                <Link to={row.to} className="flex min-h-12 items-center justify-between gap-3 py-3 text-base">
                  <span>{row.text}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                </Link>
              ) : (
                <p className="py-3 text-base">{row.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">Só o que já está na app e ficou por completar.</p>
    </AccordionSection>
  )
}

/** O «Resumo com IA» ainda não existe: ponto de extensão visível mas inativo (ADR-039, fora deste marco). */
export function AiExtensionPoint() {
  return (
    <div className="flex items-center gap-4 py-3" aria-disabled="true" data-extension="ai-summary">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-muted">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-lg leading-6 font-semibold text-muted">Resumo com IA</span>
        <span className="text-sm text-muted">Explicação em palavras simples</span>
      </span>
      <Badge>Em breve</Badge>
    </div>
  )
}

/** Resumo de um membro: o valor principal em cima e o detalhe em secções que se abrem. */
export function MemberSummaryView({ summary, firstName, canAdd }: Props) {
  const [open, setOpen] = useState<ExamParameterSeries | null>(null)
  const { medication, prescriptions, exams, appointments, alerts, missing } = summary
  const nothing = !medication && !exams && !appointments && !prescriptions
  return (
    <div className="flex flex-col gap-4">
      {medication && <AdherenceHero medication={medication} firstName={firstName} canAdd={canAdd} />}
      <div className="flex flex-col">
        {medication && <MedicationSection medication={medication} />}
        {exams && <ExamsSection exams={exams} canAdd={canAdd} onOpen={setOpen} />}
        {(appointments || exams) && (
          <AccordionSection
            title="Consultas e exames"
            icon={CalendarDays}
            tone="chat"
            summary={`${formatCount(appointments ? Object.values(appointments.byStatus).reduce((a, b) => a + b, 0) : 0, 'consulta', 'consultas')} · ${formatCount(exams ? Object.values(exams.byStatus).reduce((a, b) => a + b, 0) : 0, 'exame', 'exames')}`}
          >
            {appointments && (
              <div>
                <h3 className="font-display text-base font-semibold">Consultas</h3>
                <CountsList {...appointments} upcomingLabel="A seguir" />
              </div>
            )}
            {exams && (
              <div>
                <h3 className="font-display text-base font-semibold">Exames</h3>
                <CountsList {...exams} upcomingLabel="A seguir" />
              </div>
            )}
          </AccordionSection>
        )}
        {prescriptions && (
          <AccordionSection title="Receitas" icon={FileText} tone="chat" summary={`${formatCount(prescriptions.active, 'ativa', 'ativas')}${prescriptions.endingSoon ? ` · ${prescriptions.endingSoon} a terminar` : ''}`}>
            <div className="flex flex-col">
              <StatRow label="Ativas" value={prescriptions.active} />
              <StatRow label="A terminar" value={prescriptions.endingSoon} hint="Terminam nos próximos 14 dias" />
              <StatRow label="Concluídas ou canceladas" value={prescriptions.closedInPeriod} hint="No período" />
            </div>
          </AccordionSection>
        )}
        {alerts && (
          <AccordionSection title="Alertas" icon={Bell} tone="attention" summary={alerts.total ? `${formatCount(alerts.total, 'alerta', 'alertas')} · ${alerts.unread} por ler` : 'Nenhum alerta'}>
            {alerts.total === 0 ? (
              <p className="text-base text-muted">Nenhum alerta neste período.</p>
            ) : (
              <div className="flex flex-col">
                <StatRow label="Por ler" value={alerts.unread} />
                {alertGroups(alerts.byType).map((g) => (
                  <StatRow key={g.label} label={g.label} value={g.count} />
                ))}
                <p className="pt-2 text-base">
                  <TextLink to={paths.alerts}>Ver os alertas</TextLink>
                </p>
              </div>
            )}
          </AccordionSection>
        )}
        {missing && <MissingSection missing={missing} />}
      </div>
      {nothing && !missing?.length && <EmptyNote title="Não há nada para mostrar" description={`Só aparece o que ${firstName} partilha consigo.`} />}
      <AiExtensionPoint />
      <p className="text-sm text-muted">
        Números calculados a partir do que a família registou, de {formatShortDate(summary.period.from)} a {formatShortDate(summary.period.to)}. Não substituem a opinião do médico.
      </p>
      <ExamSeriesSheet series={open} onClose={() => setOpen(null)} />
    </div>
  )
}
