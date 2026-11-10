import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { useAsync } from '@/hooks/useAsync'
import { clinicExamOrderService } from '@/services/clinicExamOrder.service'
import {
  EXAM_ORDER_MAX_ACTIVE,
  EXAM_ORDER_NAME_MAX,
  EXAM_ORDER_NOTE_MAX,
  type ExamOrderItemInput,
} from '@/types/examOrder'

/** Valor do seletor para escrever o nome à mão. */
const FREE_TEXT = ''

export interface ExamOrderRow {
  /** Serviço `EXAM` do catálogo; vazio = texto livre em `name`. */
  serviceTypeId: string
  name: string
  note: string
  urgent: boolean
}

export const emptyExamOrderRow = (): ExamOrderRow => ({ serviceTypeId: FREE_TEXT, name: '', note: '', urgent: false })

/** Linhas com conteúdo (as vazias ignoram-se). */
export const filledExamOrderRows = (rows: ExamOrderRow[]) => rows.filter((r) => r.serviceTypeId || r.name.trim())

/** `ExamOrderItemInput[]` das linhas preenchidas: exatamente um de `name`/`serviceTypeId`. */
export function toExamOrderItems(rows: ExamOrderRow[]): ExamOrderItemInput[] {
  return filledExamOrderRows(rows).map((r) => ({
    ...(r.serviceTypeId ? { serviceTypeId: r.serviceTypeId } : { name: r.name.trim() }),
    ...(r.note.trim() ? { note: r.note.trim() } : {}),
    urgent: r.urgent,
  }))
}

/** Mensagem de erro de validação local (limites do contrato), ou `null`. */
export function examOrderRowsError(rows: ExamOrderRow[], alreadyActive = 0): string | null {
  const filled = filledExamOrderRows(rows)
  if (filled.length === 0) return 'Indique pelo menos um exame.'
  if (filled.length + alreadyActive > EXAM_ORDER_MAX_ACTIVE) {
    return `No máximo ${EXAM_ORDER_MAX_ACTIVE} pedidos ativos por consulta.`
  }
  return null
}

/**
 * Catálogo de exames ativos da clínica (`GET /clinic-portal/exam-service-types`, todos os papéis,
 * sem preço). Se falhar, a lista fica vazia e as linhas funcionam em texto livre.
 */
export function useExamCatalog() {
  const { state } = useAsync(() => clinicExamOrderService.listExamServiceTypes().catch(() => []), [])
  return state.status === 'success' ? state.data : []
}

interface ExamOrderLinesProps {
  rows: ExamOrderRow[]
  onChange: (rows: ExamOrderRow[]) => void
  /** Pedidos já ativos na marcação (para o limite de 5). */
  alreadyActive?: number
}

/**
 * Linhas de um pedido de exame (1–5): catálogo ou texto livre, nota e "Urgente". Partilhada pelo
 * `ExamOrderDialog` e pelo `CompleteConsultationForm` (clinic-portal-v2 §5.5).
 */
export function ExamOrderLines({ rows, onChange, alreadyActive = 0 }: ExamOrderLinesProps) {
  const catalog = useExamCatalog()
  const patch = (index: number, change: Partial<ExamOrderRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  const canAdd = rows.length + alreadyActive < EXAM_ORDER_MAX_ACTIVE

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => (
        <fieldset key={index} className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">Exame {index + 1}</legend>
          {catalog.length > 0 && (
            <Select
              label="Exame do catálogo"
              value={row.serviceTypeId}
              placeholder="Outro (escrever o nome)"
              options={catalog.map((service) => ({ value: service.id, label: service.name }))}
              onChange={(event) => patch(index, { serviceTypeId: event.target.value, name: '' })}
            />
          )}
          {!row.serviceTypeId && (
            <Input
              label="Nome do exame"
              placeholder="Ex.: Hemograma completo"
              maxLength={EXAM_ORDER_NAME_MAX}
              value={row.name}
              onChange={(event) => patch(index, { name: event.target.value })}
            />
          )}
          <Input
            label="Nota (opcional)"
            placeholder="Ex.: jejum de 8 h"
            maxLength={EXAM_ORDER_NOTE_MAX}
            value={row.note}
            onChange={(event) => patch(index, { note: event.target.value })}
          />
          <Switch label="Urgente" checked={row.urgent} onChange={(urgent) => patch(index, { urgent })} />
          {rows.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              icon={<Trash2 className="size-4" aria-hidden />}
            >
              Remover exame {index + 1}
            </Button>
          )}
        </fieldset>
      ))}
      {canAdd && (
        <Button
          variant="soft"
          onClick={() => onChange([...rows, emptyExamOrderRow()])}
          icon={<Plus className="size-4" aria-hidden />}
        >
          Outro exame
        </Button>
      )}
      <p className="text-sm text-muted">Não escreva dados de outras pessoas. Cada pedido só pode ser cancelado, não editado.</p>
    </div>
  )
}
