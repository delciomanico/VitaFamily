import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { parseNumber } from '@/lib/examination'
import type { ClinicExamResultInput } from '@/types/clinic'
import type { ExamDraftResult } from '@/types/clinicReport'

/** Máximo de parâmetros por exame (`ClinicCompleteExaminationRequest`). */
export const MAX_RESULTS = 50

export interface ResultRow {
  parameter: string
  value: string
  unit: string
  referenceMin: string
  referenceMax: string
}

export const emptyRow = (): ResultRow => ({ parameter: '', value: '', unit: '', referenceMin: '', referenceMax: '' })

/** Valor numérico quando possível; senão texto livre (ex.: “Negativo”). Sem qualquer interpretação (D11). */
export function rowToInput(row: ResultRow): ClinicExamResultInput {
  const numeric = parseNumber(row.value)
  return {
    parameter: row.parameter.trim(),
    ...(numeric !== null ? { valueNumeric: numeric } : { valueText: row.value.trim() }),
    unit: row.unit.trim() || undefined,
    referenceMin: parseNumber(row.referenceMin) ?? undefined,
    referenceMax: parseNumber(row.referenceMax) ?? undefined,
  }
}

export function rowsFromDraft(results: ExamDraftResult[]): ResultRow[] {
  if (results.length === 0) return [emptyRow()]
  return results.map((r) => ({
    parameter: r.parameter,
    value: r.valueNumeric !== undefined ? String(r.valueNumeric) : (r.valueText ?? ''),
    unit: r.unit ?? '',
    referenceMin: r.referenceMin !== undefined ? String(r.referenceMin) : '',
    referenceMax: r.referenceMax !== undefined ? String(r.referenceMax) : '',
  }))
}

/** Linhas preenchidas já validadas, ou a mensagem de erro (em pt-PT, sem valores). */
export function validateRows(rows: ResultRow[]): { filled: ResultRow[]; error?: string } {
  const filled = rows.filter((r) => r.parameter.trim() || r.value.trim())
  for (const row of filled) {
    if (!row.parameter.trim() || !row.value.trim()) return { filled, error: 'Cada parâmetro precisa de nome e valor.' }
    const min = parseNumber(row.referenceMin)
    const max = parseNumber(row.referenceMax)
    if ((row.referenceMin.trim() && min === null) || (row.referenceMax.trim() && max === null)) {
      return { filled, error: 'As referências têm de ser números.' }
    }
    if (min !== null && max !== null && min > max) {
      return { filled, error: 'A referência máxima não pode ser menor que a mínima.' }
    }
  }
  return { filled }
}

interface ExamResultsDraftFormProps {
  rows: ResultRow[]
  onChange: (rows: ResultRow[]) => void
  disabled?: boolean
}

/**
 * Tabela de parâmetros (parâmetro, valor, unidade, referência mín./máx.) do rascunho e da
 * conclusão (BR-CLN-47). Nenhum valor é interpretado nem realçado aqui: o realce "Fora da
 * referência" existe só dentro do PDF do laudo (BR-CLN-48).
 */
export function ExamResultsDraftForm({ rows, onChange, disabled }: ExamResultsDraftFormProps) {
  const update = (index: number, patch: Partial<ResultRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => (
        <Card key={index} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Parâmetro {index + 1}</h3>
            {rows.length > 1 && !disabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                icon={<Trash2 className="size-4" aria-hidden />}
                aria-label={`Remover parâmetro ${index + 1}`}
              >
                Remover
              </Button>
            )}
          </div>
          <Input
            label={`Parâmetro ${index + 1}`}
            placeholder="Ex.: Glicemia"
            disabled={disabled}
            value={row.parameter}
            onChange={(e) => update(index, { parameter: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Valor ${index + 1}`}
              placeholder="Ex.: 98"
              disabled={disabled}
              value={row.value}
              onChange={(e) => update(index, { value: e.target.value })}
            />
            <Input
              label={`Unidade ${index + 1}`}
              placeholder="Ex.: mg/dL"
              disabled={disabled}
              value={row.unit}
              onChange={(e) => update(index, { unit: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Referência mín. ${index + 1}`}
              inputMode="decimal"
              disabled={disabled}
              value={row.referenceMin}
              onChange={(e) => update(index, { referenceMin: e.target.value })}
            />
            <Input
              label={`Referência máx. ${index + 1}`}
              inputMode="decimal"
              disabled={disabled}
              value={row.referenceMax}
              onChange={(e) => update(index, { referenceMax: e.target.value })}
            />
          </div>
        </Card>
      ))}
      {rows.length < MAX_RESULTS && !disabled && (
        <Button variant="soft" onClick={() => onChange([...rows, emptyRow()])} icon={<Plus className="size-4" aria-hidden />}>
          Adicionar parâmetro
        </Button>
      )}
    </div>
  )
}
