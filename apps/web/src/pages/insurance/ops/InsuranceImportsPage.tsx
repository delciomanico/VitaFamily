import { useRef, useState, type FormEvent } from 'react'
import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { PageHeader } from '@/components/insurer/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { asArray, withFallback } from '@/lib/safe'
import { insurerOpsService } from '@/services/insurerOps.service'
import { importRowErrorLabel, relationshipLabel, type InsurerImport } from '@/types/insurerOps'

const MAX_BYTES = 10 * 1024 * 1024 // errors.md: FILE_TOO_LARGE acima de 10 MB
const rowError = withFallback(importRowErrorLabel, (code) => code)
const relationship = withFallback(relationshipLabel, (key) => key)

const fieldLabel: Record<string, string> = {
  name: 'Nome',
  idDocumentType: 'Tipo de documento',
  idDocumentNumber: 'Nº do documento',
  birthDate: 'Data de nascimento',
  relationship: 'Relação',
  holderIdDocumentNumber: 'Documento do titular',
  companyTaxId: 'NIF da empresa',
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="flex flex-col rounded-lg bg-surface-muted px-3 py-2">
      <span className={tone === 'danger' && value > 0 ? 'text-xl font-semibold text-danger' : 'text-xl font-semibold'}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

/** Pré-visualização: contagens, erros por linha e as primeiras linhas válidas (BR-SEG-17). */
function PreviewView({ batch }: { batch: InsurerImport }) {
  const errors = asArray(batch.errors)
  const preview = asArray(batch.preview)
  return (
    <ErrorBoundary>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Linhas no ficheiro" value={batch.rowCount} />
          <Stat label="Linhas válidas" value={batch.validRows} />
          <Stat label="Linhas com erro" value={batch.errorRows} tone="danger" />
          <Stat label="Duplicadas" value={batch.duplicateRows} tone="danger" />
        </div>

        {errors.length > 0 && (
          <section aria-labelledby="imp-errors" className="flex flex-col gap-2">
            <h2 id="imp-errors" className="text-base font-semibold">
              Erros por linha
            </h2>
            <Card className="max-h-72 overflow-y-auto py-1">
              <ul className="divide-y divide-border">
                {errors.map((e, index) => (
                  <li key={`${e.row}-${e.field ?? ''}-${index}`} className="flex flex-wrap gap-x-3 py-2 text-sm">
                    <span className="font-medium tabular-nums">Linha {e.row}</span>
                    <span className="text-muted">{e.field ? (fieldLabel[e.field] ?? e.field) : 'Linha'}</span>
                    <span className="text-danger">{e.message || rowError[e.code]}</span>
                  </li>
                ))}
              </ul>
            </Card>
            {batch.errorsTruncated && (
              <p className="text-sm text-muted">Só se mostram os primeiros 500 erros; corrija o ficheiro e carregue de novo.</p>
            )}
          </section>
        )}

        {preview.length > 0 && (
          <section aria-labelledby="imp-preview" className="flex flex-col gap-2">
            <h2 id="imp-preview" className="text-base font-semibold">
              Pré-visualização (primeiras {preview.length} linhas válidas)
            </h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Linha</th>
                    <th scope="col" className="px-3 py-2 font-medium">Nome</th>
                    <th scope="col" className="px-3 py-2 font-medium">Documento</th>
                    <th scope="col" className="px-3 py-2 font-medium">Nascimento</th>
                    <th scope="col" className="px-3 py-2 font-medium">Relação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((r) => (
                    <tr key={r.row}>
                      <td className="px-3 py-2 tabular-nums">{r.row}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">
                        {r.idDocumentType} {r.idDocumentNumber}
                      </td>
                      <td className="px-3 py-2">{formatShortDate(r.birthDate)}</td>
                      <td className="px-3 py-2">{relationship[r.relationship]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        )}
      </div>
    </ErrorBoundary>
  )
}

/**
 * Importação de beneficiários (BR-SEG-17, UC-SEG-02): carregar CSV/XLSX → pré-visualização com
 * erros por linha → confirmar. Os importados entram PENDENTES; linhas com erro ou duplicadas
 * são ignoradas e contadas, nunca duplicam nem atualizam.
 */
export function InsuranceImportsPage() {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [batch, setBatch] = useState<InsurerImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'upload' | 'commit' | 'cancel' | null>(null)

  function reset() {
    setFile(null)
    setBatch(null)
    setError(null)
    if (input.current) input.current.value = ''
  }

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file) return setError('Escolha um ficheiro CSV ou XLSX.')
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError('Tipo de ficheiro não permitido. Use CSV ou XLSX.')
    if (file.size > MAX_BYTES) return setError('O ficheiro é demasiado grande (máximo 10 MB).')
    setBusy('upload')
    setError(null)
    try {
      setBatch(await insurerOpsService.createImport(file))
    } catch (err) {
      setError(
        isAppError(err, 'VALIDATION_ERROR')
          ? 'O ficheiro não é válido: confirme o cabeçalho, que tem entre 1 e 5.000 linhas, e tente de novo.'
          : errorMessage(err),
      )
    } finally {
      setBusy(null)
    }
  }

  async function commit() {
    if (!batch) return
    setBusy('commit')
    setError(null)
    try {
      const done = await insurerOpsService.commitImport(batch.id)
      setBatch(done)
      toast.show('Importação concluída.')
    } catch (err) {
      setError(isAppError(err, 'CONFLICT') ? 'Este lote já foi confirmado ou cancelado.' : errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (!batch) return
    setBusy('cancel')
    try {
      await insurerOpsService.cancelImport(batch.id)
      toast.show('Lote cancelado.')
      reset()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const committed = batch?.status === 'COMMITTED'
  const preview = batch?.status === 'PREVIEW'

  return (
    <>
      <PageHeader
        title="Importação de beneficiários"
        description="Carregue um CSV (UTF-8, separador , ou ;) ou XLSX (1.ª folha) com até 5.000 linhas. Nada é gravado até confirmar."
      />

      {!batch && (
        <Card>
          <form onSubmit={(e) => void upload(e)} className="flex flex-col gap-4" aria-label="Carregar ficheiro de beneficiários">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="import-file" className="text-sm font-medium">
                Ficheiro
              </label>
              <input
                id="import-file"
                ref={input}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setError(null)
                }}
                className="block w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              />
            </div>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer font-medium text-foreground">Colunas esperadas</summary>
              <p className="mt-2">
                Cabeçalho com: <code>name</code>, <code>idDocumentType</code>, <code>idDocumentNumber</code>, <code>birthDate</code> (AAAA-MM-DD),{' '}
                <code>relationship</code> (HOLDER, SPOUSE, CHILD ou OTHER), <code>holderIdDocumentNumber</code> (obrigatória se não for titular; o titular tem de existir na seguradora ou no mesmo ficheiro) e{' '}
                <code>companyTaxId</code> (opcional; empresa existente).
              </p>
            </details>
            <FormError message={error} />
            <Button type="submit" loading={busy === 'upload'} icon={<Upload className="size-4" aria-hidden />} className="self-start">
              Carregar e pré-visualizar
            </Button>
          </form>
        </Card>
      )}

      {batch && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="size-5 text-muted" aria-hidden />
            <span className="font-medium">{file?.name ?? `Lote ${batch.format}`}</span>
            <Badge tone={committed ? 'success' : batch.status === 'FAILED' ? 'danger' : 'warning'} dot>
              {committed ? 'Confirmado' : batch.status === 'FAILED' ? 'Falhou' : batch.status === 'CANCELLED' ? 'Cancelado' : 'Pré-visualização'}
            </Badge>
          </div>

          {committed && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-3.5 py-3 text-sm text-success">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {batch.importedRows ?? 0} beneficiários importados como pendentes; {batch.errorRows} linhas ignoradas
                {batch.duplicateRows > 0 ? ` (${batch.duplicateRows} duplicadas)` : ''}. Ative-os na página de beneficiários depois de validar.
              </span>
            </p>
          )}
          {preview && batch.errorRows > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              As linhas com erro não serão importadas; as válidas entram como pendentes.
            </p>
          )}

          <PreviewView batch={batch} />
          <FormError message={error} />

          <div className="flex flex-wrap gap-2">
            {preview && (
              <>
                <Button onClick={() => void commit()} loading={busy === 'commit'} disabled={batch.validRows === 0}>
                  Confirmar importação ({batch.validRows})
                </Button>
                <Button variant="secondary" onClick={() => void cancel()} loading={busy === 'cancel'}>
                  Cancelar lote
                </Button>
              </>
            )}
            {!preview && (
              <Button variant="secondary" onClick={reset}>
                Importar outro ficheiro
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}
