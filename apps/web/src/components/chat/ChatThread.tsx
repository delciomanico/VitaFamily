import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { controlClasses, controlState } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import {
  CHAT_MAX_LENGTH,
  CHAT_WARNING,
  REPORT_ADMIN_NOTICE,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  readOnlyNotice,
  reportReasonLabel,
  validMessageText,
} from '@/lib/marketplace'
import { cn } from '@/lib/cn'
import type {
  ChatMessage,
  ChatSide,
  ConversationClosedBy,
  ConversationStatus,
  MessageReportReason,
  Page,
  ReportMessageInput,
} from '@/types/marketplace'

export interface ChatThreadConversation {
  id: string
  status: ConversationStatus
  closedBy?: ConversationClosedBy
  canSend: boolean
}

export interface ChatThreadProps {
  side: ChatSide
  conversation: ChatThreadConversation
  /** Primeira página (sem cursor) ou páginas mais antigas (com `nextCursor`). */
  load: (cursor?: string) => Promise<Page<ChatMessage>>
  send: (text: string, clientMessageId: string) => Promise<ChatMessage>
  markRead: (upToSeq: number) => Promise<unknown>
  report: (messageId: string, input: ReportMessageInput) => Promise<unknown>
  /** Chamado depois de enviar ou marcar como lido, para a página recarregar a conversa. */
  onChanged?: () => void
  /** Mostra o aviso fixo sobre dados de saúde perto do campo de escrita (a família). */
  warning?: boolean
}

type Phase = 'loading' | 'ready' | 'error'

/** Junta mensagens sem duplicar por id e devolve-as por ordem cronológica (seq crescente). */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const message of [...current, ...incoming]) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

/** Limite de tamanho tem texto próprio: a família só precisa de saber que deve esperar pela resposta. */
function sendErrorMessage(error: unknown): string {
  return isAppError(error, 'LIMIT_EXCEEDED') ? 'Aguarde a resposta do profissional.' : errorMessage(error)
}

/**
 * Conversa de mercado (MK2) partilhada pela família e pelo profissional. Texto sempre como texto simples
 * (nunca HTML); o texto das mensagens é dado de saúde potencial e não vai para logs (BR-MKT-46).
 */
export function ChatThread({ side, conversation, load, send, markRead, report, onChanged, warning = false }: ChatThreadProps) {
  const toast = useToast()
  const fieldId = useId()
  const warningId = useId()
  const counterId = useId()
  const [phase, setPhase] = useState<Phase>('loading')
  const [attempt, setAttempt] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [olderBusy, setOlderBusy] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null)
  const [reason, setReason] = useState<MessageReportReason | ''>('')
  const [note, setNote] = useState('')
  const [reportError, setReportError] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  /** Chave de idempotência do envio em curso: reutilizada num reenvio do mesmo texto, renovada após sucesso. */
  const pendingRef = useRef<{ id: string; text: string } | null>(null)
  const lastMarkedRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  /** Altura da lista antes de juntar mensagens antigas, para manter a posição de leitura. */
  const anchorHeightRef = useRef<number | null>(null)

  // `load` pode mudar de identidade a cada render do pai; a primeira página só se carrega ao trocar de conversa.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    let active = true
    setPhase('loading')
    setMessages([])
    setNextCursor(null)
    setOlderError(null)
    setSendError(null)
    lastMarkedRef.current = 0
    loadRef.current().then(
      (page) => {
        if (!active) return
        setMessages(mergeMessages([], page.items))
        setNextCursor(page.nextCursor)
        setPhase('ready')
      },
      () => {
        if (active) setPhase('error')
      },
    )
    return () => {
      active = false
    }
  }, [conversation.id, attempt])

  const latest = messages[messages.length - 1]
  const latestSeq = latest?.seq
  const latestFromOther = latest !== undefined && !latest.mine

  // Marca como lido até à mensagem mais recente do outro lado, uma vez por seq (sem ciclos).
  useEffect(() => {
    if (phase !== 'ready' || latestSeq === undefined || !latestFromOther) return
    if (latestSeq <= lastMarkedRef.current) return
    lastMarkedRef.current = latestSeq
    markRead(latestSeq).then(
      () => onChanged?.(),
      () => undefined,
    )
  }, [phase, latestSeq, latestFromOther, markRead, onChanged])

  // Mostra sempre a mensagem mais recente, exceto quando se juntam mensagens antigas (ver `loadOlder`).
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [latestSeq])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && anchorHeightRef.current !== null) {
      list.scrollTop += list.scrollHeight - anchorHeightRef.current
      anchorHeightRef.current = null
    }
  }, [messages])

  async function loadOlder() {
    if (!nextCursor || olderBusy) return
    setOlderBusy(true)
    setOlderError(null)
    anchorHeightRef.current = listRef.current?.scrollHeight ?? null
    try {
      const page = await load(nextCursor)
      setMessages((current) => mergeMessages(current, page.items))
      setNextCursor(page.nextCursor)
    } catch (error) {
      anchorHeightRef.current = null
      setOlderError(errorMessage(error))
    } finally {
      setOlderBusy(false)
    }
  }

  const text = validMessageText(draft)

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (text === null || sending) return
    const pending = pendingRef.current
    const clientMessageId = pending?.text === text ? pending.id : crypto.randomUUID()
    pendingRef.current = { id: clientMessageId, text }
    setSending(true)
    setSendError(null)
    try {
      const message = await send(text, clientMessageId)
      pendingRef.current = null
      setMessages((current) => mergeMessages(current, [message]))
      setDraft('')
      onChanged?.()
    } catch (error) {
      setSendError(sendErrorMessage(error))
      // Estado da conversa mudou entretanto (fechada, conta suspensa): a página deve refletir isso.
      if (isAppError(error, 'CONVERSATION_CLOSED') || isAppError(error, 'PROFESSIONAL_LOCKED')) onChanged?.()
    } finally {
      setSending(false)
    }
  }

  function openReport(message: ChatMessage) {
    setReportTarget(message)
    setReason('')
    setNote('')
    setReportError(null)
  }

  function closeReport() {
    if (!reporting) setReportTarget(null)
  }

  async function submitReport() {
    if (!reportTarget || reason === '' || reporting) return
    setReporting(true)
    setReportError(null)
    try {
      await report(reportTarget.id, { reason, note: note.trim() || undefined })
      setReportTarget(null)
      toast.show('Denúncia enviada. A mensagem continua visível até haver decisão.')
    } catch (error) {
      setReportError(errorMessage(error))
    } finally {
      setReporting(false)
    }
  }

  const readOnly = conversation.canSend ? null : readOnlyNotice(conversation.canSend, conversation.status, conversation.closedBy, side)
  const counterText = `${draft.length}/${CHAT_MAX_LENGTH}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {phase === 'loading' && <LoadingState rows={3} label="A carregar mensagens…" />}
        {phase === 'error' && (
          <ErrorState message="Não foi possível carregar as mensagens." onRetry={() => setAttempt((n) => n + 1)} />
        )}
        {phase === 'ready' && nextCursor && (
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => void loadOlder()} loading={olderBusy}>
              Carregar mensagens anteriores
            </Button>
          </div>
        )}
        {phase === 'ready' && <FormError message={olderError} />}
        {phase === 'ready' && messages.length === 0 && (
          <p className="text-center text-sm text-muted">Ainda não há mensagens nesta conversa.</p>
        )}
        <ul role="log" aria-live="polite" aria-label="Mensagens" className="flex flex-col gap-3">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} reportable={message.side !== side} onReport={openReport} />
          ))}
        </ul>
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        {readOnly ? (
          <p role="status" className="rounded-md bg-surface-muted px-3.5 py-3 text-sm text-muted">
            {readOnly}
          </p>
        ) : (
          <form onSubmit={onSend} className="flex flex-col gap-2">
            {warning && (
              <p id={warningId} className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{CHAT_WARNING}</span>
              </p>
            )}
            <label htmlFor={fieldId} className="sr-only">
              Escrever mensagem
            </label>
            <textarea
              id={fieldId}
              rows={2}
              maxLength={CHAT_MAX_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={sending}
              aria-describedby={warning ? `${warningId} ${counterId}` : counterId}
              placeholder="Escreva a sua mensagem"
              className={cn(controlClasses, controlState(), 'resize-none py-2.5')}
            />
            <div className="flex items-center justify-between gap-3">
              <span id={counterId} className="text-xs text-muted">
                {counterText}
              </span>
              <Button type="submit" size="sm" disabled={text === null} loading={sending}>
                Enviar
              </Button>
            </div>
            <FormError message={sendError} />
          </form>
        )}
      </div>

      <Modal
        open={reportTarget !== null}
        onClose={closeReport}
        title="Denunciar mensagem"
        footer={
          <>
            <Button variant="secondary" onClick={closeReport} disabled={reporting}>
              Voltar
            </Button>
            <Button onClick={() => void submitReport()} loading={reporting} disabled={reason === ''}>
              Enviar denúncia
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{REPORT_ADMIN_NOTICE}</p>
          <Select
            label="Motivo"
            placeholder="Escolha o motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value as MessageReportReason | '')}
            options={REPORT_REASONS.map((value) => ({ value, label: reportReasonLabel[value] }))}
          />
          <Textarea
            label="Nota (opcional)"
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint={`${note.length}/${REPORT_NOTE_MAX}`}
          />
          <FormError message={reportError} />
        </div>
      </Modal>
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  /** Só mensagens do outro lado se denunciam (o outro tutor da família é o mesmo lado). */
  reportable: boolean
  onReport: (message: ChatMessage) => void
}

function MessageBubble({ message, reportable, onReport }: MessageBubbleProps) {
  const { mine } = message
  return (
    <li className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm',
            mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-surface-muted text-foreground',
          )}
        >
          {message.hidden ? (
            <p className="italic">Mensagem ocultada pela moderação.</p>
          ) : (
            <p className="break-words whitespace-pre-wrap">{message.text ?? ''}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <time dateTime={message.createdAt}>{formatWhenLuanda(message.createdAt)}</time>
          <span aria-hidden="true">#{message.seq}</span>
          {mine && <span>{message.readByOtherSide ? 'Lida' : 'Enviada'}</span>}
          {!mine && reportable && !message.hidden && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onReport(message)}>
              Denunciar
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
