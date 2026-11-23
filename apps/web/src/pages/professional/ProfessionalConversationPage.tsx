import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Ellipsis, MessageCircle } from 'lucide-react'
import { ChatThread } from '@/components/chat/ChatThread'
import { ConfirmSheet, Sheet } from '@/components/app/Sheet'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { closedByLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { professionalConversationService } from '@/services/professionalConversation.service'
import type { ProfessionalConversation } from '@/types/marketplace'

/**
 * Conversa do lado do profissional, em ecrã inteiro (como uma app de mensagens). A vista só mostra a identidade de
 * apresentação da família (`participantLabel`); nunca ids de família, membro ou utilizador (BR-MKT-38).
 */
export function ProfessionalConversationPage() {
  usePageTitle('Conversa')
  const { conversationId = '' } = useParams()
  const toast = useToast()
  const profile = useProfessionalProfile()
  const approved = profile.profile?.validationStatus === 'APPROVED'

  const [optionsOpen, setOptionsOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Atualização silenciosa: o fio não pode desmontar ao recarregar a conversa.
  const [refreshed, setRefreshed] = useState<ProfessionalConversation | null>(null)

  const base = useAsync(() => professionalConversationService.get(conversationId), [conversationId])
  const loaded = base.state.status === 'success' ? base.state.data : null
  const conv = refreshed?.id === conversationId ? refreshed : loaded
  const loadError = base.state.status === 'error' ? base.state.error : null
  const notFound = isAppError(loadError, 'NOT_FOUND') || isAppError(loadError, 'FORBIDDEN')

  async function refresh() {
    try {
      setRefreshed(await professionalConversationService.get(conversationId))
    } catch {
      // Falha silenciosa: a conversa continua com os dados que já tem.
    }
  }

  async function changeState(action: 'close' | 'reopen') {
    setBusy(true)
    try {
      if (action === 'close') await professionalConversationService.close(conversationId)
      else await professionalConversationService.reopen(conversationId)
      await refresh()
      toast.show(action === 'close' ? 'Conversa fechada.' : 'Conversa reaberta.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(false)
      setCloseOpen(false)
      setOptionsOpen(false)
    }
  }

  // Fechar exige conversa aberta e conta aprovada (canSend); reabrir só o que o próprio profissional fechou.
  const canClose = conv?.status === 'OPEN' && conv.canSend
  const canReopen = conv?.status === 'CLOSED' && conv.closedBy === 'PROFESSIONAL' && approved
  const stateText = !conv ? '' : conv.status === 'CLOSED' ? (conv.closedBy ? closedByLabel[conv.closedBy] : 'Conversa fechada') : conv.canSend ? 'Aberta' : 'Só leitura'

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex min-h-16 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 pt-[var(--safe-top)]">
        <Link to={paths.professionalConversations} className="inline-flex min-h-14 items-center gap-0.5 rounded-full pe-3 ps-1 text-base font-medium text-primary hover:bg-primary-soft">
          <ChevronLeft className="size-6" aria-hidden />
          Voltar
        </Link>
        {conv && (
          <>
            <Avatar name={conv.participantLabel} size="md" />
            <div className="min-w-0 flex-1 ps-1">
              <h1 className="truncate text-lg leading-6 font-semibold">{conv.participantLabel}</h1>
              <p className="truncate text-sm text-muted">{stateText}</p>
            </div>
            {(canClose || canReopen) && (
              <Button variant="ghost" onClick={() => setOptionsOpen(true)} icon={<Ellipsis className="size-5" aria-hidden />}>
                Opções
              </Button>
            )}
          </>
        )}
      </header>

      {base.state.status === 'loading' && (
        <div className="p-5">
          <LoadingState rows={2} />
        </div>
      )}
      {base.state.status === 'error' && (
        <div className="p-5">
          {notFound ? <EmptyState icon={MessageCircle} title="Não encontrámos esta conversa" description="Volte à lista de conversas." /> : <ErrorState onRetry={base.reload} />}
        </div>
      )}

      {conv && (
        <ChatThread
          variant="app"
          warning
          side="PROFESSIONAL"
          conversation={{ id: conv.id, status: conv.status, closedBy: conv.closedBy, canSend: conv.canSend }}
          load={(cursor) => professionalConversationService.messages(conversationId, cursor)}
          send={(text, clientMessageId) => professionalConversationService.send(conversationId, { text, clientMessageId })}
          markRead={(upToSeq) => professionalConversationService.markRead(conversationId, upToSeq)}
          report={(messageId, input) => professionalConversationService.report(conversationId, messageId, input)}
          onChanged={() => void refresh()}
        />
      )}

      <Sheet open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Opções da conversa">
        {canClose && (
          <Button
            size="xl"
            variant="secondary"
            fullWidth
            onClick={() => {
              setOptionsOpen(false)
              setCloseOpen(true)
            }}
          >
            Fechar a conversa
          </Button>
        )}
        {canReopen && (
          <Button size="xl" variant="primary" fullWidth onClick={() => void changeState('reopen')} loading={busy}>
            Reabrir a conversa
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={closeOpen}
        title="Fechar esta conversa?"
        description="Ninguém poderá escrever mais. Só você a pode reabrir."
        yesLabel="Sim, fechar"
        destructive
        loading={busy}
        onNo={() => setCloseOpen(false)}
        onYes={() => void changeState('close')}
      />
    </div>
  )
}
