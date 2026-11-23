import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, FileText, ImageIcon, LoaderCircle, ScanSearch } from 'lucide-react'
import { Sheet } from '@/components/app/Sheet'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { OCR_ATTACH_MAX_BYTES, OCR_MAX_PDF_PAGES } from '@/lib/ocrConfig'
import type { ExamDraft, PrescriptionDraft } from '@/lib/ocrParse'
import { planExaminationReview, planPrescriptionReview, type ReviewRow } from '@/lib/ocrReview'
import { readDocument, type FailReason, type ReadKind, type ReadProgress, type ReadStage } from '@/lib/ocrRun'
import type { DocumentUpload } from '@/types/document'

/**
 * Entrada «fotografar primeiro» (M16, UC-OCR-01/02/03): escolher câmara, galeria ou PDF → leitura com progresso →
 * lista do que foi encontrado, com «Confirmar» onde é preciso → formulário pré-preenchido (a página). A leitura corre
 * neste aparelho: nada sai dele até o utilizador guardar. Há sempre «Preencher à mão» (BR-OCR-01, BR-OCR-10).
 */

export interface IntakeOutcome<D> {
  /** Rascunho lido; null no caminho manual ou se a leitura falhou. */
  draft: D | null
  /** O documento original, a anexar (o utilizador pode retirá-lo no formulário). */
  original: DocumentUpload | null
  /** Aviso simples para o topo do formulário (falha, páginas ignoradas, versão reduzida). */
  notice: string | null
  confirmed: ReadonlySet<string>
  confirm(key: string): void
}

interface Labels {
  title: string
  /** «a receita» / «o resultado do exame» */
  what: string
  photoButton: string
  found: string
}

const LABELS: Record<ReadKind, Labels> = {
  PRESCRIPTION: { title: 'Adicionar receita', what: 'a receita', photoButton: 'Fotografar a receita', found: 'Encontrámos isto na receita' },
  EXAMINATION: { title: 'Adicionar exame', what: 'o resultado', photoButton: 'Fotografar o resultado', found: 'Encontrámos isto no resultado' },
}

const FAILURE: Record<Exclude<FailReason, 'cancelled'>, string> = {
  unreadable: 'Não conseguimos ler bem esta imagem. Tente com mais luz e com a folha toda à vista. Pode preencher à mão: a foto fica anexada.',
  timeout: 'A leitura demorou demasiado. Pode preencher à mão: a foto fica anexada.',
  engine: 'Não foi possível ler a foto neste aparelho. Pode preencher à mão: a foto fica anexada.',
}

const STAGES: { stage: ReadStage; label: string }[] = [
  { stage: 'preparing', label: 'A preparar' },
  { stage: 'reading', label: 'A ler' },
  { stage: 'filling', label: 'A preencher' },
]

const FIRST_TIME_KEY = 'vf.ocr.prepared'
const firstTime = () => {
  try {
    return window.localStorage.getItem(FIRST_TIME_KEY) === null
  } catch {
    return false
  }
}

interface RawOutcome {
  draft: PrescriptionDraft | ExamDraft | null
  original: DocumentUpload | null
  notice: string | null
}

type Stage =
  | { name: 'choose'; error?: string }
  | { name: 'reading'; file: File }
  | { name: 'result'; file: File; draft: PrescriptionDraft | ExamDraft; notice: string | null }
  | { name: 'done'; outcome: RawOutcome }

interface OcrIntakeProps<K extends ReadKind> {
  kind: K
  onClose: () => void
  children: (outcome: IntakeOutcome<K extends 'PRESCRIPTION' ? PrescriptionDraft : ExamDraft>) => ReactNode
}

const asUpload = (file: File): DocumentUpload => ({ originalName: file.name, mimeType: file.type, sizeBytes: file.size, file })

export function OcrIntake<K extends ReadKind>({ kind, onClose, children }: OcrIntakeProps<K>) {
  const labels = LABELS[kind]
  const [stage, setStage] = useState<Stage>({ name: 'choose' })
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())
  const confirm = (key: string) => setConfirmed((current) => new Set(current).add(key))

  // Leitura em curso: o AbortController serve o «Cancelar» e o «Preencher à mão».
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function pick(raw: File | undefined) {
    if (!raw) return
    const { acceptableOriginal } = await import('@/lib/ocrImage')
    const file = raw.type === 'application/pdf' || raw.type === 'image/jpeg' || raw.type === 'image/png' ? raw : await acceptableOriginal(raw)
    if (!file) return setStage({ name: 'choose', error: 'Escolha uma foto (JPG ou PNG) ou um PDF.' })
    setStage({ name: 'reading', file })
  }

  async function finish(file: File, draft: PrescriptionDraft | ExamDraft | null, notice: string | null) {
    let original = file
    let extra = notice
    if (file.size > OCR_ATTACH_MAX_BYTES && file.type.startsWith('image/')) {
      try {
        const { reduceForAttachment } = await import('@/lib/ocrImage')
        original = await reduceForAttachment(file)
        extra = [notice, 'A foto era grande: anexámos uma versão mais leve.'].filter(Boolean).join(' ')
      } catch {
        /* sem redução, anexa-se o original; o registo valida o tamanho */
      }
    }
    setStage({ name: 'done', outcome: { draft, original: asUpload(original), notice: extra } })
  }

  if (stage.name === 'done') {
    const { outcome } = stage
    return <>{children({ ...outcome, draft: outcome.draft as never, confirmed, confirm })}</>
  }

  const manual = () => setStage({ name: 'done', outcome: { draft: null, original: null, notice: null } })

  return (
    <>
      {stage.name === 'choose' && <ChooseSheet labels={labels} error={stage.error} onPick={pick} onManual={manual} onClose={onClose} />}
      {stage.name === 'reading' && (
        <ReadingSheet
          key={stage.file.name + stage.file.size}
          labels={labels}
          file={stage.file}
          kind={kind}
          controller={controller}
          onDone={(draft, notice) => setStage({ name: 'result', file: stage.file, draft, notice })}
          onFail={(reason) => void finish(stage.file, null, FAILURE[reason])}
          onBack={() => setStage({ name: 'choose' })}
          onManual={() => void finish(stage.file, null, null)}
        />
      )}
      {stage.name === 'result' && (
        <ResultSheet
          labels={labels}
          kind={kind}
          file={stage.file}
          draft={stage.draft}
          notice={stage.notice}
          confirmed={confirmed}
          onConfirm={confirm}
          onNext={() => void finish(stage.file, stage.draft, stage.notice)}
          onAgain={() => setStage({ name: 'choose' })}
          onClose={onClose}
        />
      )}
    </>
  )
}

function ChooseSheet({ labels, error, onPick, onManual, onClose }: { labels: Labels; error?: string; onPick: (file: File | undefined) => void; onManual: () => void; onClose: () => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const pdf = useRef<HTMLInputElement>(null)
  const input = (ref: React.RefObject<HTMLInputElement | null>, id: string, accept: string, capture?: 'environment') => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      capture={capture}
      data-testid={id}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        onPick(event.target.files?.[0])
        event.target.value = ''
      }}
    />
  )
  return (
    <Sheet
      open
      onClose={onClose}
      title={labels.title}
      description={`Fotografe ${labels.what} e os campos vêm preenchidos. Só tem de confirmar.`}
      footer={
        <>
          <Button size="xl" fullWidth onClick={() => camera.current?.click()} icon={<Camera className="size-6" aria-hidden />}>
            {labels.photoButton}
          </Button>
          <Button size="xl" variant="secondary" fullWidth onClick={() => gallery.current?.click()} icon={<ImageIcon className="size-6" aria-hidden />}>
            Escolher da galeria
          </Button>
          <Button size="xl" variant="secondary" fullWidth onClick={() => pdf.current?.click()} icon={<FileText className="size-6" aria-hidden />}>
            Escolher PDF
          </Button>
          <Button size="xl" variant="ghost" fullWidth onClick={onManual}>
            Preencher à mão
          </Button>
        </>
      }
    >
      {input(camera, 'ocr-input-camera', 'image/*', 'environment')}
      {input(gallery, 'ocr-input-gallery', 'image/*')}
      {input(pdf, 'ocr-input-pdf', 'application/pdf')}
      {error && (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      )}
      <p className="text-base text-muted">A foto é lida neste aparelho e não sai dele.</p>
    </Sheet>
  )
}

function ReadingSheet({ labels, file, kind, controller, onDone, onFail, onBack, onManual }: { labels: Labels; file: File; kind: ReadKind; controller: React.RefObject<AbortController | null>; onDone: (draft: PrescriptionDraft | ExamDraft, notice: string | null) => void; onFail: (reason: Exclude<FailReason, 'cancelled'>) => void; onBack: () => void; onManual: () => void }) {
  const [progress, setProgress] = useState<ReadProgress>({ stage: 'preparing', percent: 0 })
  const first = useMemo(firstTime, [])
  const latest = useRef({ onDone, onFail, onBack })
  latest.current = { onDone, onFail, onBack }

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    void readDocument(file, kind, { signal: abort.signal, onProgress: setProgress }).then((result) => {
      if (abort.signal.aborted) return
      if (result.status === 'failed') return result.reason === 'cancelled' ? latest.current.onBack() : latest.current.onFail(result.reason)
      try {
        window.localStorage.setItem(FIRST_TIME_KEY, '1')
      } catch {
        /* sem armazenamento: só perde a nota «só na primeira vez» */
      }
      latest.current.onDone(result.draft, result.ignoredPages > 0 ? `O PDF tem mais páginas: lemos só as primeiras ${OCR_MAX_PDF_PAGES}.` : null)
    })
    return () => abort.abort()
  }, [file, kind, controller])

  const current = STAGES.findIndex((s) => s.stage === progress.stage)
  return (
    <Sheet
      open
      onClose={() => {
        controller.current?.abort()
        onBack()
      }}
      title={`A ler ${labels.what}`}
      description={progress.stage === 'preparing' && first ? 'A preparar a leitura (só na primeira vez).' : 'Pode demorar alguns segundos.'}
      footer={
        <>
          <Button
            size="xl"
            variant="secondary"
            fullWidth
            onClick={() => {
              controller.current?.abort()
              onBack()
            }}
          >
            Cancelar
          </Button>
          <Button
            size="xl"
            variant="ghost"
            fullWidth
            onClick={() => {
              controller.current?.abort()
              onManual()
            }}
          >
            Preencher à mão
          </Button>
        </>
      }
    >
      <div
        role="progressbar"
        aria-label="Progresso da leitura"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={`${STAGES[current]?.label ?? ''}, ${progress.percent}%`}
        className="h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
      </div>
      <ol className="flex flex-col divide-y divide-border">
        {STAGES.map((s, index) => (
          <li key={s.stage} aria-current={index === current ? 'step' : undefined} className={cn('flex items-center gap-3 py-3 text-lg', index > current && 'text-muted')}>
            {index < current ? <Check className="size-6 text-success" aria-hidden /> : index === current ? <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden /> : <span className="size-6 rounded-full border-2 border-border" aria-hidden />}
            <span className={cn(index === current && 'font-semibold')}>{s.label}</span>
            {index === current && <span className="ms-auto text-base text-muted">{progress.percent}%</span>}
          </li>
        ))}
      </ol>
    </Sheet>
  )
}

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return
    const created = URL.createObjectURL(file)
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [file])
  return url ? (
    <img src={url} alt="A foto que escolheu" className="h-28 w-full rounded-xl object-cover object-top" />
  ) : (
    <div className="flex h-16 items-center gap-3 text-base text-muted">
      <FileText className="size-6" aria-hidden />
      {file.name}
    </div>
  )
}

function ResultSheet({ labels, kind, file, draft, notice, confirmed, onConfirm, onNext, onAgain, onClose }: { labels: Labels; kind: ReadKind; file: File; draft: PrescriptionDraft | ExamDraft; notice: string | null; confirmed: ReadonlySet<string>; onConfirm: (key: string) => void; onNext: () => void; onAgain: () => void; onClose: () => void }) {
  const rows: ReviewRow[] = (kind === 'PRESCRIPTION' ? planPrescriptionReview(draft as PrescriptionDraft, () => '') : planExaminationReview(draft as ExamDraft, () => '')).rows
  const pending = rows.filter((r) => r.needsConfirm && !confirmed.has(r.key)).length
  return (
    <Sheet
      open
      onClose={onClose}
      title={labels.found}
      description="Confirme o que está assinalado. No passo seguinte pode corrigir tudo."
      footer={
        <>
          <Button size="xl" fullWidth onClick={onNext}>
            Rever e guardar
          </Button>
          <Button size="xl" variant="ghost" fullWidth onClick={onAgain}>
            Tirar outra foto
          </Button>
        </>
      }
    >
      <Thumbnail file={file} />
      {notice && <p className="rounded-xl bg-primary-soft px-3.5 py-3 text-base text-primary">{notice}</p>}
      <ul className="flex flex-col divide-y divide-border" aria-label="Campos encontrados">
        {rows.map((r) => {
          const needs = r.needsConfirm && !confirmed.has(r.key)
          return (
            <li key={r.key} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-base text-muted">{r.label}</span>
                <span className="block text-lg font-medium break-words">{r.value}</span>
              </span>
              {needs ? (
                <Button variant="secondary" size="lg" onClick={() => onConfirm(r.key)} aria-label={`Confirmar: ${r.label}`} className="shrink-0 border-2 border-dashed border-warning" icon={<ScanSearch className="size-5" aria-hidden />}>
                  Confirmar
                </Button>
              ) : r.needsConfirm ? (
                <span className="flex shrink-0 items-center gap-1.5 text-base text-success">
                  <Check className="size-5" aria-hidden />
                  Confirmado
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {pending > 0 && <p className="text-base text-warning">{pending === 1 ? 'Há 1 campo' : `Há ${pending} campos`} para confirmar. Pode fazê-lo já ou no passo seguinte.</p>}
    </Sheet>
  )
}
