import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AiAnswerView } from '@/components/assistant/AiAnswerView'
import { Page } from '@/components/layout/Page'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { Switch } from '@/components/ui/Switch'
import { Textarea } from '@/components/ui/Textarea'
import { useAuth } from '@/contexts/AuthContext'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { useAsync } from '@/hooks/useAsync'
import { runAssistant } from '@/lib/ai/assistant'
import { PROVIDERS } from '@/lib/ai/providers'
import { minorNotice } from '@/lib/ai/texts'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { aiService } from '@/services/ai.service'
import type { AiProviderId, AiResult } from '@/types/ai'
import { Sparkles } from 'lucide-react'

const MAX_TEXT = 1000

/** Análise de sintomas leve (UC-AI-03): o texto sai DESTE aparelho direto para o fornecedor escolhido; a Vita nunca o vê. */
export function SymptomsPage() {
  const enabled = useAiEnabled()
  const { user, family } = useAuth()
  const [params] = useSearchParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [text, setText] = useState('')
  const [includeContext, setIncludeContext] = useState(false)
  const [provider, setProvider] = useState<AiProviderId | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ value: AiResult; disclaimer: string } | null>(null)

  const members = useAsync(() => (enabled ? aiService.eligibleMembers(familyId, userId) : Promise.resolve([])), [enabled, familyId, userId])
  const list = members.state.status === 'success' ? members.state.data : []
  const member = list.find((m) => m.id === params.get('membro')) ?? list[0]
  const consents = useAsync(() => (member ? aiService.listConsents(familyId, member.id) : Promise.resolve([])), [familyId, member?.id])
  const connected = (consents.state.status === 'success' ? consents.state.data : []).filter((c) => c.revokedAt === null).map((c) => c.provider)
  const chosen = provider && connected.includes(provider) ? provider : connected[0]
  const isMinor = member ? !member.isSelf : false

  async function analyse() {
    if (!member || !chosen || text.trim().length < 3) return
    setBusy(true)
    setResult(null)
    try {
      const value = await runAssistant({ familyId, memberId: member.id, provider: chosen, kind: 'SYMPTOMS', symptoms: text.trim(), includeContext })
      const disclaimer = value.kind === 'ANSWER' ? value.disclaimer : ''
      setResult({ value, disclaimer })
    } finally {
      setBusy(false)
    }
  }

  if (!enabled) {
    return (
      <Page title="Tenho sintomas" backTo={paths.assistant} backLabel="Assistente">
        <EmptyState icon={Sparkles} title="O assistente ainda não está disponível" />
      </Page>
    )
  }

  return (
    <Page title="Tenho sintomas" description="Orientação geral, não um diagnóstico." backTo={paths.assistant} backLabel="Assistente">
      {(members.state.status === 'loading' || consents.state.status === 'loading') && <LoadingState rows={3} />}
      {(members.state.status === 'error' || consents.state.status === 'error') && <ErrorState onRetry={() => { members.reload(); consents.reload() }} />}

      {member && consents.state.status === 'success' && connected.length === 0 && (
        <EmptyState icon={Sparkles} title="Ligue primeiro uma IA" description="Escolha um fornecedor no Assistente e aceite o consentimento." action={<ButtonLink to={paths.assistant}>Ir para o Assistente</ButtonLink>} />
      )}

      {member && connected.length > 0 && (
        <>
          <p role="note" className="rounded-2xl bg-warning-soft p-4 text-base text-warning">
            Em caso de emergência (dor forte no peito, falta de ar, desmaio, hemorragia…) não use isto: procure ajuda imediata. {isMinor && minorNotice}
          </p>

          <Textarea
            label={member.isSelf ? 'O que está a sentir?' : `O que está a sentir ${member.name.split(' ')[0] ?? ''}?`}
            hint="O que escrever sai da Vita Family e vai direto para a IA que escolher. Não escreva nomes."
            rows={5}
            maxLength={MAX_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {connected.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm text-muted">Enviar para</legend>
              <div className="flex flex-wrap gap-2">
                {connected.map((id) => (
                  <button key={id} type="button" aria-pressed={chosen === id} onClick={() => setProvider(id)} className={cn('min-h-11 rounded-full border px-4 text-base', chosen === id ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-border')}>
                    {PROVIDERS.find((p) => p.id === id)?.label ?? id}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {!isMinor && (
            <Switch label="Incluir o meu contexto" description="Envia também as condições de saúde ativas. Desligado por omissão." checked={includeContext} onChange={setIncludeContext} />
          )}

          <Button size="xl" fullWidth loading={busy} disabled={text.trim().length < 3} onClick={() => void analyse()}>
            Analisar
          </Button>

          {busy && <LoadingState rows={2} label="A pensar…" />}
          {result && <AiAnswerView result={result.value} disclaimer={result.disclaimer} />}
        </>
      )}
    </Page>
  )
}
