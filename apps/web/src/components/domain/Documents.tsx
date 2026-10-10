import { useId, useRef, useState } from 'react'
import { FileImage, FileText, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatLongDate } from '@/lib/format'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  DOCUMENTS_PER_RESOURCE,
  type DocumentInfo,
  type DocumentUpload,
} from '@/types/document'

/** “182 KB”, “1,2 MB”. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith('image/') ? FileImage : FileText
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

interface DocumentPickerProps {
  label: string
  value: DocumentUpload[]
  onChange: (value: DocumentUpload[]) => void
}

/**
 * Anexar documentos (BR-DOC-01/03: PDF, JPG ou PNG, até 10 MB, máx. 5).
 * Nos mocks só se guardam nome, tipo e tamanho; o conteúdo não sai do dispositivo.
 * TODO(backend): enviar o ficheiro e mostrar o estado da análise antivírus (BR-DOC-02).
 */
export function DocumentPicker({ label, value, onChange }: DocumentPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const [error, setError] = useState<string | null>(null)
  const full = value.length >= DOCUMENTS_PER_RESOURCE

  function onFiles(files: FileList | null) {
    setError(null)
    const picked = [...(files ?? [])]
    const invalid = picked.find(
      (file) => !(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type) || file.size > DOCUMENT_MAX_BYTES,
    )
    if (invalid) setError(`“${invalid.name}” não é PDF, JPG ou PNG até 10 MB.`)
    const valid = picked
      .filter((file) => file !== invalid)
      .map((file) => ({ originalName: file.name, mimeType: file.type, sizeBytes: file.size }))
    const next = [...value, ...valid]
    if (next.length > DOCUMENTS_PER_RESOURCE) setError(`Pode anexar até ${DOCUMENTS_PER_RESOURCE} documentos.`)
    onChange(next.slice(0, DOCUMENTS_PER_RESOURCE))
    if (input.current) input.current.value = ''
  }

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((doc, index) => (
            <li
              key={`${doc.originalName}-${index}`}
              className="flex items-center gap-3 rounded-xl bg-surface-muted p-2.5"
            >
              <FileIcon mimeType={doc.mimeType} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{doc.originalName}</span>
                <span className="block text-xs text-muted">{formatFileSize(doc.sizeBytes)}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remover ${doc.originalName}`}
                className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-border"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={DOCUMENT_MIME_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => onFiles(event.target.files)}
      />
      {!full && (
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => input.current?.click()}
          icon={<Paperclip className="size-4" aria-hidden />}
        >
          Anexar documento
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="text-sm text-muted">PDF, JPG ou PNG, até 10 MB.</p>
      )}
    </div>
  )
}

/** Documento anexado, com o botão “Ver documento”. */
export function DocumentRow({ document }: { document: DocumentInfo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-3 py-3">
      <FileIcon mimeType={document.mimeType} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{document.originalName}</span>
        <span className="block text-sm text-muted">{formatFileSize(document.sizeBytes)}</span>
      </span>
      <Button variant="soft" size="sm" onClick={() => setOpen(true)}>
        Ver documento
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={document.originalName}
        description={`Anexado em ${formatLongDate(document.createdAt)} · ${formatFileSize(document.sizeBytes)}`}
      >
        {/* Os mocks não guardam ficheiros: a pré-visualização é ilustrativa. */}
        <div className="flex aspect-[3/4] max-h-80 flex-col gap-3 self-center rounded-lg border border-border bg-surface-muted p-6">
          <span className="h-3 w-2/3 rounded-full bg-border-strong" />
          <span className="h-2 w-1/2 rounded-full bg-border" />
          <span className="mt-4 h-2 w-full rounded-full bg-border" />
          <span className="h-2 w-5/6 rounded-full bg-border" />
          <span className="h-2 w-4/6 rounded-full bg-border" />
          <span className="mt-auto h-2 w-1/3 self-end rounded-full bg-border-strong" />
        </div>
        <p className="text-center text-sm text-muted">
          Pré-visualização de demonstração: o ficheiro original fica disponível com o servidor.
        </p>
      </Modal>
    </div>
  )
}
