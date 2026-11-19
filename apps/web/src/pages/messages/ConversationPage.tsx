import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { ChatThread } from '@/components/chat/ChatThread'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { AppError, errorMessage, isAppError } from '@/lib/errors'
import { closedByLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { conversationService } from '@/services/conversation.service'
import type { FamilyConversation } from '@/types/marketplace'

/** Uma conversa da família: cabeçalho com estado e ações, e o fio de mensagens (MK2). */
export function ConversationPage() {
  const { memberId = '', conversationId = '' } = useParams()
  const { user, family } = useAuth()
  const toast = useToast()
  const familyId = family?.id
  const userId = user?.id
  const session = familyId && userId ? { familyId, userId } : null

  const [closeOpen, setCloseOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Atualização silenciosa da conversa: não passa pelo estado de loading, para o fio não desmontar.
  const [refreshed, setRefreshed] = useState<FamilyConversation | null>(null)

  const base = useAsync(
    () =>
      session
        ? conversationService.get(session.familyId, session.userId, memberId, conversationId)
        : Promise.reject(new AppError('FORBIDDEN')),
    [familyId, userId, memberId, conversationId],
  )
  const loaded = base.state.status === 'success' ? base.state.data : null
  const conv = refreshed?.id === conversationId ? refreshed : loaded

  async function refresh() {
    if (!session) return
    try {
      setRefreshed(await conversationService.get(session.familyId, session.userId, memberId, conversationId))
    } catch {
      // Falha silenciosa: a conversa continua com os dados que já tem.
    }
  }

  async function changeState(action: 'close' | 'reopen') {
    if (!session) return
    setBusy(true)
    try {
      if (action === 'close') await conversationService.close(session.familyId, session.userId, memberId, conversationId)
      else await conversationService.reopen(session.familyId, session.userId, memberId, conversationId)
      await refresh()
      toast.show(action === 'close' ? 'Conversa arrumada.' : 'Conversa reaberta.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusy(false)
      setCloseOpen(false)
    }
  }

  const canClose = conv?.status === 'OPEN'
  const canReopen = conv?.status === 'CLOSED' && conv.closedBy === 'FAMILY'
  const loadError = base.state.status === 'error' ? base.state.error : null
  // Sem enumeração: não encontrada e sem acesso dão a mesma resposta.
  const notFound = isAppError(loadError, 'NOT_FOUND') || isAppError(loadError, 'FORBIDDEN')

  return (
    <Page title="Conversa" backTo={paths.messages} fullScreen>
      {base.state.status === 'loading' && <LoadingState rows={2} />}
      {base.state.status === 'error' &&
        (notFound ? (
          <EmptyState
            icon={MessageCircle}
            title="Não encontrámos esta conversa"
            description="Confirme o endereço ou volte às mensagens."
            action={
              <ButtonLink to={paths.messages} variant="secondary" size="sm">
                Voltar às mensagens
              </ButtonLink>
            }
          />
        ) : (
          <ErrorState onRetry={base.reload} />
        ))}

      {conv && session && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Card className="flex shrink-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link to={paths.marketplaceProfessional(conv.professional.id)} className="font-semibold underline-offset-2 hover:underline">
                  {conv.professional.displayName}
                </Link>
                {conv.professional.city && <p className="text-sm text-muted">{conv.professional.city}</p>}
                <p className="text-sm text-muted">Tratado/a como {conv.participantLabel}</p>
                {conv.status === 'CLOSED' && conv.closedBy && <p className="text-xs text-muted">{closedByLabel[conv.closedBy]}</p>}
              </div>
              {conv.status === 'CLOSED' ? (
                <Badge>Fechada</Badge>
              ) : conv.canSend ? (
                <Badge tone="success" dot>
                  Aberta
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Indisponível
                </Badge>
              )}
            </div>

            {(canClose || canReopen) && (
              <div className="flex flex-wrap gap-2">
                {canClose && (
                  <Button variant="secondary" size="sm" onClick={() => setCloseOpen(true)} disabled={busy}>
                    Arrumar
                  </Button>
                )}
                {canReopen && (
                  <Button variant="soft" size="sm" onClick={() => void changeState('reopen')} loading={busy}>
                    Reabrir
                  </Button>
                )}
              </div>
            )}
          </Card>

          <ChatThread
            side="FAMILY"
            warning
            conversation={{ id: conv.id, status: conv.status, closedBy: conv.closedBy, canSend: conv.canSend }}
            load={(cursor) => conversationService.messages(session.familyId, session.userId, memberId, conversationId, cursor)}
            send={(text, clientMessageId) =>
              conversationService.send(session.familyId, session.userId, memberId, conversationId, { text, clientMessageId })
            }
            markRead={(upToSeq) => conversationService.markRead(session.familyId, session.userId, memberId, conversationId, upToSeq)}
            report={(messageId, input) =>
              conversationService.report(session.familyId, session.userId, memberId, conversationId, messageId, input)
            }
            onChanged={() => void refresh()}
          />
        </div>
      )}

      <ConfirmDialog
        open={closeOpen}
        title="Arrumar esta conversa?"
        description="A conversa fica só de leitura e deixa de aceitar mensagens. Pode reabri-la depois."
        confirmLabel="Arrumar"
        loading={busy}
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => void changeState('close')}
      />
    </Page>
  )
}
