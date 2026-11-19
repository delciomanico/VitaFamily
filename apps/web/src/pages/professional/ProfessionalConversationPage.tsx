import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, MessageCircle } from 'lucide-react'
import { ChatThread } from '@/components/chat/ChatThread'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
 * Conversa do lado do profissional. A vista só mostra a identidade de apresentação da família
 * (`participantLabel`); nunca ids de família, membro ou utilizador (BR-MKT-38).
 */
export function ProfessionalConversationPage() {
  usePageTitle('Conversa')
  const { conversationId = '' } = useParams()
  const toast = useToast()
  const profile = useProfessionalProfile()
  const approved = profile.profile?.validationStatus === 'APPROVED'

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
    }
  }

  // Fechar exige conversa aberta e conta aprovada (canSend); reabrir só o que o próprio profissional fechou.
  const canClose = conv?.status === 'OPEN' && conv.canSend
  const canReopen = conv?.status === 'CLOSED' && conv.closedBy === 'PROFESSIONAL' && approved

  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-[32rem] flex-col gap-4">
      <Link to={paths.professionalConversations} className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Voltar às conversas
      </Link>

      {base.state.status === 'loading' && <LoadingState rows={2} />}
      {base.state.status === 'error' &&
        (notFound ? (
          <EmptyState icon={MessageCircle} title="Não encontrámos esta conversa" description="Volte à lista de conversas." />
        ) : (
          <ErrorState onRetry={base.reload} />
        ))}

      {conv && (
        <>
          <div className="flex shrink-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 truncate text-xl font-semibold">{conv.participantLabel}</h1>
              {conv.status === 'CLOSED' ? (
                <Badge>{conv.closedBy ? closedByLabel[conv.closedBy] : 'Fechada'}</Badge>
              ) : conv.canSend ? (
                <Badge tone="success" dot>
                  Aberta
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Só leitura
                </Badge>
              )}
            </div>

            {(canClose || canReopen) && (
              <Card className="flex flex-wrap gap-2 p-3">
                {canClose && (
                  <Button variant="secondary" size="sm" onClick={() => setCloseOpen(true)} disabled={busy}>
                    Fechar conversa
                  </Button>
                )}
                {canReopen && (
                  <Button variant="soft" size="sm" onClick={() => void changeState('reopen')} loading={busy}>
                    Reabrir
                  </Button>
                )}
              </Card>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <ChatThread
              side="PROFESSIONAL"
              conversation={{ id: conv.id, status: conv.status, closedBy: conv.closedBy, canSend: conv.canSend }}
              load={(cursor) => professionalConversationService.messages(conversationId, cursor)}
              send={(text, clientMessageId) => professionalConversationService.send(conversationId, { text, clientMessageId })}
              markRead={(upToSeq) => professionalConversationService.markRead(conversationId, upToSeq)}
              report={(messageId, input) => professionalConversationService.report(conversationId, messageId, input)}
              onChanged={() => void refresh()}
            />
          </div>
        </>
      )}

      <ConfirmDialog
        open={closeOpen}
        title="Fechar esta conversa?"
        description="Fechar trava novas mensagens; só você a pode reabrir."
        confirmLabel="Fechar conversa"
        destructive
        loading={busy}
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => void changeState('close')}
      />
    </div>
  )
}
