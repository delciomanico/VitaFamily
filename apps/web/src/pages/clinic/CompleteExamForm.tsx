import { useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
import { parseNumber } from '@/lib/examination'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicExamBooking, ClinicExamResultInput } from '@/types/clinic'
import { DOCUMENT_MAX_BYTES } from '@/types/document'

/** Máximo de parâmetros por exame (`ClinicCompleteExaminationRequest`). */
const MAX_RESULTS = 50

interface ResultRow {
  parameter: string
  value: string
  unit: string
  referenceMin: string
  referenceMax: string
}

const emptyRow = (): ResultRow => ({ parameter: '', value: '', unit: '', referenceMin: '', referenceMax: '' })

/** Valor numérico quando possível; senão texto livre (ex.: “Negativo”). Sem qualquer interpretação (D11). */
function toInput(row: ResultRow): ClinicExamResultInput {
  const numeric = parseNumber(row.value)
  return {
    parameter: row.parameter.trim(),
    ...(numeric !== null ? { valueNumeric: numeric } : { valueText: row.value.trim() }),
    unit: row.unit.trim() || undefined,
    referenceMin: parseNumber(row.referenceMin) ?? undefined,
    referenceMax: parseNumber(row.referenceMax) ?? undefined,
  }
}

interface CompleteExamFormProps {
  booking: ClinicExamBooking
  onClose: () => void
  onCompleted: () => void
}

/**
 * Emitir os resultados de um exame (BR-CLN-08): parâmetros estruturados e/ou PDF, mais uma nota
 * opcional. A clínica regista os valores e as referências do boletim; a app nunca os interpreta.
 */
export function CompleteExamForm({ booking, onClose, onCompleted }: CompleteExamFormProps) {
  const [rows, setRows] = useState<ResultRow[]>([emptyRow()])
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (index: number, patch: Partial<ResultRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  async function submit() {
    const filled = rows.filter((r) => r.parameter.trim() || r.value.trim())
    for (const row of filled) {
      if (!row.parameter.trim() || !row.value.trim()) return setError('Cada parâmetro precisa de nome e valor.')
      const min = parseNumber(row.referenceMin)
      const max = parseNumber(row.referenceMax)
      if ((row.referenceMin.trim() && min === null) || (row.referenceMax.trim() && max === null)) {
        return setError('As referências têm de ser números.')
      }
      if (min !== null && max !== null && min > max) return setError('A referência máxima não pode ser menor que a mínima.')
    }
    if (filled.length === 0 && !file && booking.documents.length === 0) {
      return setError('Indique pelo menos um parâmetro ou anexe o PDF dos resultados.')
    }
    if (file && (file.type !== 'application/pdf' || file.size > DOCUMENT_MAX_BYTES)) {
      return setError('O ficheiro tem de ser um PDF até 10 MB.')
    }
    setSaving(true)
    try {
      if (file) {
        await clinicPortalService.uploadExamDocument(booking.id, {
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          file,
        })
      }
      await clinicPortalService.completeExam(booking.id, { results: filled.map(toInput), resultNote: note })
      onCompleted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Emitir resultados"
      description={`${booking.patientName} · ${booking.examType ?? 'Exame'}. Os valores ficam visíveis para o paciente, sem interpretação.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Concluir exame
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.map((row, index) => (
          <Card key={index} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Parâmetro {index + 1}</h3>
              {rows.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  icon={<Trash2 className="size-4" aria-hidden />}
                >
                  Remover
                </Button>
              )}
            </div>
            <Input
              label={`Parâmetro ${index + 1}`}
              placeholder="Ex.: Glicemia"
              value={row.parameter}
              onChange={(e) => update(index, { parameter: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={`Valor ${index + 1}`}
                placeholder="Ex.: 98"
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
              />
              <Input
                label={`Unidade ${index + 1}`}
                placeholder="Ex.: mg/dL"
                value={row.unit}
                onChange={(e) => update(index, { unit: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={`Referência mín. ${index + 1}`}
                inputMode="decimal"
                value={row.referenceMin}
                onChange={(e) => update(index, { referenceMin: e.target.value })}
              />
              <Input
                label={`Referência máx. ${index + 1}`}
                inputMode="decimal"
                value={row.referenceMax}
                onChange={(e) => update(index, { referenceMax: e.target.value })}
              />
            </div>
          </Card>
        ))}
        {rows.length < MAX_RESULTS && (
          <Button
            variant="soft"
            onClick={() => setRows((current) => [...current, emptyRow()])}
            icon={<Plus className="size-4" aria-hidden />}
          >
            Adicionar parâmetro
          </Button>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="exam-pdf" className="text-sm font-medium">
            PDF dos resultados (opcional)
          </label>
          <input
            id="exam-pdf"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {booking.documents.map((doc) => (
            <p key={doc.id} className="flex items-center gap-1.5 text-sm text-muted">
              <FileText className="size-4" aria-hidden /> {doc.originalName}
            </p>
          ))}
        </div>

        <Textarea label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
