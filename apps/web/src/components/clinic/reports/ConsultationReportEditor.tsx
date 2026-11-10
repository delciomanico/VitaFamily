import { Switch } from '@/components/ui/Switch'
import { reportTemplateFor } from '@/config/reportTemplates'
import { REPORT_LIMITS, type ConsultationReportInput, type ReportSection } from '@/types/clinicReport'
import { ReportSectionField } from './ReportSectionField'

const LABELS: Record<ReportSection, string> = {
  reason: 'Motivo da consulta',
  findings: 'Achados',
  impression: 'Diagnóstico / impressão',
  plan: 'Conduta / plano',
}

/** Texto das 4 secções + partilha, em estado de formulário (strings; vazio = sem texto). */
export interface ReportDraftFields {
  reason: string
  findings: string
  impression: string
  plan: string
  sharedWithPatient: boolean
}

export const emptyReportFields = (): ReportDraftFields => ({
  reason: '',
  findings: '',
  impression: '',
  plan: '',
  sharedWithPatient: true,
})

export const hasReportText = (v: ReportDraftFields) => [v.reason, v.findings, v.impression, v.plan].some((t) => t.trim())

export const toReportInput = (v: ReportDraftFields, shareable: boolean): ConsultationReportInput => ({
  reason: v.reason,
  findings: v.findings,
  impression: v.impression,
  plan: v.plan,
  ...(shareable ? { sharedWithPatient: v.sharedWithPatient } : {}),
})

interface ConsultationReportEditorProps {
  value: ReportDraftFields
  onChange: (value: ReportDraftFields) => void
  /** Especialidade da marcação, para os textos-guia estáticos. */
  specialty?: string
  /** Falso em visitas manuais: sem partilha com o paciente (BR-CLN-45). */
  shareable?: boolean
}

/** As 4 secções do relatório (ADR-027): texto simples, contadores de limite e textos-guia. */
export function ConsultationReportEditor({ value, onChange, specialty, shareable = true }: ConsultationReportEditorProps) {
  const template = reportTemplateFor(specialty)
  const set = (patch: Partial<ReportDraftFields>) => onChange({ ...value, ...patch })
  return (
    <div className="flex flex-col gap-4">
      {(Object.keys(LABELS) as ReportSection[]).map((section) => (
        <ReportSectionField
          key={section}
          label={LABELS[section]}
          max={REPORT_LIMITS[section]}
          placeholder={template[section]}
          value={value[section]}
          onChange={(text) => set({ [section]: text })}
        />
      ))}
      {shareable && (
        <Switch
          label="Partilhar com o paciente na app"
          description="Só depois de finalizado e só o titular ou tutor vê. Não pode ser alterado depois de finalizar."
          checked={value.sharedWithPatient}
          onChange={(sharedWithPatient) => set({ sharedWithPatient })}
        />
      )}
      <p className="text-sm text-muted">Texto simples. Não escreva dados de outras pessoas.</p>
    </div>
  )
}
