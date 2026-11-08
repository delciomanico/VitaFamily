import type { ReportSection } from '@/types/clinicReport'

const TITLES: Record<ReportSection, string> = {
  reason: 'Motivo da consulta',
  findings: 'Achados',
  impression: 'Diagnóstico / impressão',
  plan: 'Conduta / plano',
}

/** Secções preenchidas, só leitura (relatório FINAL, vista de Admin/Gestor e do paciente). */
export function ReportSectionsView({ report }: { report: Partial<Record<ReportSection, string>> }) {
  const filled = (Object.keys(TITLES) as ReportSection[]).filter((section) => report[section])
  return (
    <dl className="flex flex-col gap-4">
      {filled.map((section) => (
        <div key={section} className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-muted">{TITLES[section]}</dt>
          <dd className="whitespace-pre-line">{report[section]}</dd>
        </div>
      ))}
    </dl>
  )
}
