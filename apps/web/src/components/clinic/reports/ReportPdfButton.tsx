import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { errorMessage } from '@/lib/errors'
import { openPdfInNewTab } from '@/lib/pdf'

interface ReportPdfButtonProps {
  /** Pede o PDF (gerado pelo servidor a pedido; não se guarda). */
  load: () => Promise<Blob>
  label?: string
  variant?: 'primary' | 'soft' | 'secondary' | 'ghost'
}

/** Abre/descarrega um PDF num separador novo (`noopener`); erros em aviso, sem texto clínico. */
export function ReportPdfButton({ load, label = 'Imprimir / PDF', variant = 'secondary' }: ReportPdfButtonProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    try {
      openPdfInNewTab(await load())
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant={variant} size="sm" loading={busy} onClick={() => void open()} icon={<FileText className="size-4" aria-hidden />}>
      {label}
    </Button>
  )
}
