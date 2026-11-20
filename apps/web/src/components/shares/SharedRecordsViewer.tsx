import type { ReactNode } from 'react'
import { Card } from '@/components/ui/Card'
import { formatAge, formatShortDate, formatShortDateLuanda, formatWhenLuanda } from '@/lib/format'
import { bloodTypeLabel } from '@/lib/recordSharing'
import type { SharedRecordsView } from '@/types/recordSharing'

/**
 * Conteúdo de uma partilha aberta, só para leitura. Todo o texto vem dos registos da família e é mostrado como
 * texto (nunca HTML). A marca de água (nome público e dia da abertura) sobrepõe-se a todo o conteúdo, em todas as
 * aberturas (BR-MKT-72): dissuade e identifica, não impede capturas. O conteúdo vive só neste estado do ecrã.
 */
export function SharedRecordsViewer({ view }: { view: SharedRecordsView }) {
  const mark = `${view.watermark.professionalName} · ${formatShortDate(view.watermark.openedOn)}`
  return (
    <div className="relative isolate overflow-hidden rounded-xl" data-testid="shared-records">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{view.participantLabel}</h2>
          <p className="text-sm text-muted">{formatAge(view.ageYears)}</p>
          <p className="text-xs text-muted">
            Aberto {formatWhenLuanda(view.openedAt)} · disponível até {formatWhenLuanda(view.expiresAt)}
            {view.viewOnce ? ' · só podia ser aberto uma vez' : ''}
          </p>
        </Card>

        {view.allergies && (
          <Section title="Alergias e tipo de sangue">
            {view.bloodType && <p className="text-sm">Tipo de sangue: {bloodTypeLabel[view.bloodType]}</p>}
            <List empty="Sem alergias registadas." items={view.allergies.map((a) => `${a.name}${a.since ? ` (desde ${formatShortDate(a.since)})` : ''}`)} />
          </Section>
        )}
        {view.conditions && (
          <Section title="Condições e antecedentes">
            <List
              empty="Sem condições registadas."
              items={view.conditions.map((c) => `${c.name} · ${c.kind === 'CONDITION' ? 'condição' : 'antecedente'}${c.since ? ` · desde ${formatShortDate(c.since)}` : ''}${c.until ? ` até ${formatShortDate(c.until)}` : ''}`)}
            />
          </Section>
        )}
        {view.medications && (
          <Section title="Medicação ativa">
            <List
              empty="Sem medicação ativa."
              items={view.medications.map((m) => `${m.name} ${m.dosage} · desde ${formatShortDateLuanda(m.startAt)}${m.continuous || !m.endAt ? ' · uso contínuo' : ` até ${formatShortDateLuanda(m.endAt)}`}`)}
            />
          </Section>
        )}
        {view.appointments && (
          <Section title="Consultas">
            <List
              empty="Sem consultas."
              items={view.appointments.map((a) => `${formatWhenLuanda(a.scheduledAt)}${a.specialty ? ` · ${a.specialty}` : ''}${a.professionalName ? ` · ${a.professionalName}` : ''} · ${appointmentStatus[a.status]}`)}
            />
          </Section>
        )}
        {view.examinations && (
          <Section title="Exames">
            {view.examinations.length === 0 && <p className="text-sm text-muted">Sem exames.</p>}
            {view.examinations.map((exam, index) => (
              <div key={index} className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {exam.name} · {formatShortDate(exam.examDate)} · {exam.status === 'COMPLETED' ? 'realizado' : 'marcado'}
                </p>
                {exam.results.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-sm text-muted">
                    {exam.results.map((r, i) => (
                      <li key={i}>
                        {r.parameter}: {r.valueNumeric ?? r.valueText ?? '—'}
                        {r.unit ? ` ${r.unit}` : ''}
                        {r.referenceMin !== undefined || r.referenceMax !== undefined ? ` (referência ${r.referenceMin ?? '…'} a ${r.referenceMax ?? '…'})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Section>
        )}
      </div>

      {/* Marca de água sobreposta a todo o conteúdo; não intercepta cliques nem é lida em voz alta (a identificação está no cabeçalho). */}
      <div aria-hidden data-testid="watermark" className="pointer-events-none absolute inset-0 z-10 grid select-none grid-cols-2 content-around gap-x-4 gap-y-10 overflow-hidden sm:grid-cols-3">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className="-rotate-20 text-center text-sm font-semibold whitespace-nowrap text-foreground/20">
            {mark}
          </span>
        ))}
      </div>
    </div>
  )
}

const appointmentStatus: Record<string, string> = {
  REQUESTED: 'pedida',
  SCHEDULED: 'marcada',
  REJECTED: 'recusada',
  COMPLETED: 'realizada',
  NO_SHOW: 'faltou',
  CANCELLED: 'cancelada',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </Card>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
