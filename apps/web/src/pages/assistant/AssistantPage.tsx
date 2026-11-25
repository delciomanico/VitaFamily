import { useCallback, useState } from 'react'
import { ChevronRight, MessageCircleHeart, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ConfirmSheet, Sheet } from '@/components/app/Sheet'
import { ConnectSheet } from '@/components/assistant/ConnectSheet'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { useAsync } from '@/hooks/useAsync'
import { googleClientId, revokeGoogleToken } from '@/lib/ai/google'
import { keyStore } from '@/lib/ai/keyStore'
import { PROVIDERS, type ProviderInfo } from '@/lib/ai/providers'
import { hasApiBackend } from '@/lib/apiClient'
import { paths } from '@/routes/paths'
import { aiService, type AiMember } from '@/services/ai.service'
import type { AiConsent } from '@/types/ai'

/** Assistente Vita (UC-AI-01/04): escolher quem, ligar ou desligar um fornecedor de IA e ir para a análise de sintomas. */
export function AssistantPage() {
  const enabled = useAiEnabled()
  const { user, family } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [picked, setPicked] = useState<string | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [connecting, setConnecting] = useState<ProviderInfo | null>(null)
  const [disconnecting, setDisconnecting] = useState<ProviderInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const members = useAsync(() => (enabled ? aiService.eligibleMembers(familyId, userId) : Promise.resolve<AiMember[]>([])), [enabled, familyId, userId])
  const list = members.state.status === 'success' ? members.state.data : []
  const member = list.find((m) => m.id === picked) ?? list[0]

  const consents = useAsync(() => (member ? aiService.listConsents(familyId, member.id) : Promise.resolve<AiConsent[]>([])), [familyId, member?.id])
  const active = new Set((consents.state.status === 'success' ? consents.state.data : []).filter((c) => c.revokedAt === null).map((c) => c.provider))
  const connectedCount = active.size

  const offered = PROVIDERS.filter((p) => p.connect !== 'google' || !hasApiBackend() || Boolean(googleClientId()))

  const disconnect = useCallback(async () => {
    if (!disconnecting || !member) return
    setBusy(true)
    try {
      await aiService.revokeConsent(familyId, member.id, disconnecting.id)
      if (disconnecting.connect === 'apiKey') await keyStore().remove(disconnecting.id).catch(() => undefined)
      else await revokeGoogleToken()
      toast.show('Assistente desligado.')
      setDisconnecting(null)
      consents.reload()
    } catch {
      toast.show('Não foi possível desligar. Tente de novo.', 'error')
    } finally {
      setBusy(false)
    }
  }, [disconnecting, member, familyId, toast, consents])

  if (!enabled) {
    return (
      <Page title="Assistente Vita" backTo={paths.settings} backLabel="Perfil">
        <EmptyState icon={Sparkles} title="O assistente ainda não está disponível" description="Quando estiver, aparece aqui para ligar." />
      </Page>
    )
  }

  return (
    <Page title="Assistente Vita" description="Explica os seus números e ajuda a perceber os sintomas, em linguagem simples." backTo={paths.settings} backLabel="Perfil">
      {members.state.status === 'loading' && <LoadingState rows={3} />}
      {members.state.status === 'error' && <ErrorState onRetry={members.reload} />}
      {members.state.status === 'success' && !member && <EmptyState icon={Sparkles} title="Sem pessoas disponíveis" description="O assistente só se usa para si ou para um dependente de quem é tutor." />}

      {member && (
        <>
          <button
            type="button"
            disabled={list.length < 2}
            onClick={() => setPickOpen(true)}
            aria-label={list.length > 1 ? `Assistente para: ${member.name}. Mudar` : undefined}
            className="flex min-h-16 items-center gap-4 border-b border-border pb-3 text-start disabled:cursor-default"
          >
            <Avatar name={member.name} size="lg" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm text-muted">Assistente para</span>
              <span className="truncate font-display text-xl leading-6 font-semibold">{member.isSelf ? 'Eu' : member.name.split(' ')[0]}</span>
            </span>
            {list.length > 1 && <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />}
          </button>

          <section aria-labelledby="providers-title" className="flex flex-col gap-1">
            <h2 id="providers-title" className="text-base font-medium text-muted">
              Ligar a uma IA
            </h2>
            {consents.state.status === 'loading' && <LoadingState rows={3} />}
            {consents.state.status === 'error' && <ErrorState onRetry={consents.reload} />}
            {consents.state.status === 'success' && (
              <ul className="flex flex-col">
                {offered.map((p) => (
                  <li key={p.id} className="flex min-h-16 items-center gap-3 border-b border-border py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-sm text-muted">{p.connect === 'google' ? 'Entrar com a conta Google' : 'Com a sua chave de API'}</span>
                    </span>
                    {active.has(p.id) ? (
                      <>
                        <Badge tone="success">Ligado</Badge>
                        <Button variant="ghost" size="md" onClick={() => setDisconnecting(p)}>
                          Desligar
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" size="md" onClick={() => setConnecting(p)}>
                        Ligar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <ButtonLink to={`${paths.assistantSymptoms}?membro=${member.id}`} size="xl" fullWidth icon={<MessageCircleHeart className="size-5" aria-hidden />} aria-disabled={connectedCount === 0}>
              Tenho sintomas
            </ButtonLink>
            {connectedCount === 0 && <p className="text-sm text-muted">Ligue primeiro uma IA acima. Para um resumo dos números, use «Explicar com IA» no Resumo de saúde.</p>}
            <Link to={paths.healthSummary} className="text-base font-medium text-primary underline-offset-4 hover:underline">
              Ir para o Resumo de saúde
            </Link>
          </section>
        </>
      )}

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Assistente para quem?">
        <ul className="flex flex-col pb-2">
          {list.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={member?.id === m.id}
                onClick={() => {
                  setPicked(m.id)
                  setPickOpen(false)
                }}
                className="flex min-h-16 w-full items-center gap-4 border-b border-border py-2 text-start"
              >
                <Avatar name={m.name} size="lg" />
                <span className="flex-1 text-lg">{m.isSelf ? `${m.name} (eu)` : m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {connecting && member && (
        <ConnectSheet
          open
          onClose={() => setConnecting(null)}
          provider={connecting}
          member={member}
          familyId={familyId}
          onConnected={() => {
            setConnecting(null)
            toast.show('Assistente ligado.')
            consents.reload()
          }}
        />
      )}
      <ConfirmSheet
        open={disconnecting !== null}
        title={`Desligar ${disconnecting?.label ?? ''}?`}
        description="Apaga a chave deste aparelho e retira o seu consentimento. Não há nada guardado para apagar na Vita Family."
        yesLabel="Sim, desligar"
        noLabel="Não, manter"
        loading={busy}
        onYes={() => void disconnect()}
        onNo={() => setDisconnecting(null)}
      />
    </Page>
  )
}
