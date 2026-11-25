import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { useAsync } from '@/hooks/useAsync'
import { runAssistant } from '@/lib/ai/assistant'
import { providerLabel } from '@/lib/ai/providers'
import { paths } from '@/routes/paths'
import { aiService } from '@/services/ai.service'
import type { AiProviderId, AiResult } from '@/types/ai'
import { AiAnswerView } from './AiAnswerView'

interface Props {
  memberId: string
  range: { from: string; to: string }
}

/**
 * «Explicar com IA» no Resumo de saúde (UC-AI-02, BR-AI-15): a explicação aparece AO LADO dos números em bruto do mesmo resumo e nunca isolada,
 * sempre com o aviso. Só existe com o assistente ligado no servidor e para o próprio/dependente de quem se é tutor.
 */
export function AiSummaryCard({ memberId, range }: Props) {
  const enabled = useAiEnabled()
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ value: AiResult; disclaimer: string } | null>(null)

  const eligible = useAsync(() => (enabled ? aiService.eligibleMembers(familyId, userId) : Promise.resolve([])), [enabled, familyId, userId])
  const allowed = eligible.state.status === 'success' && eligible.state.data.some((m) => m.id === memberId)
  const consents = useAsync(() => (allowed ? aiService.listConsents(familyId, memberId) : Promise.resolve([])), [allowed, familyId, memberId])
  const connected: AiProviderId[] = (consents.state.status === 'success' ? consents.state.data : []).filter((c) => c.revokedAt === null).map((c) => c.provider)

  if (!enabled || !allowed || consents.state.status !== 'success') return null

  async function explain(provider: AiProviderId) {
    setBusy(true)
    setResult(null)
    try {
      const value = await runAssistant({ familyId, memberId, provider, kind: 'SUMMARY', from: range.from, to: range.to })
      setResult({ value, disclaimer: value.kind === 'ANSWER' ? value.disclaimer : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="ai-title" className="flex flex-col gap-3 border-b border-border pb-5">
      <h2 id="ai-title" className="flex items-center gap-2 text-base font-medium text-muted">
        <Sparkles className="size-5 text-primary" aria-hidden /> Explicação com IA
      </h2>
      {connected.length === 0 ? (
        <p className="text-base">
          Ligue uma IA para receber uma explicação simples destes números.{' '}
          <Link to={paths.assistant} className="font-medium text-primary underline-offset-4 hover:underline">
            Ligar agora
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {connected.map((provider) => (
            <Button key={provider} variant={connected.length === 1 ? 'primary' : 'secondary'} size="lg" fullWidth loading={busy} onClick={() => void explain(provider)}>
              Explicar com {providerLabel(provider)}
            </Button>
          ))}
          <p className="text-sm text-muted">Os números (sem nomes) saem deste aparelho para o fornecedor escolhido.</p>
        </div>
      )}
      {busy && <LoadingState rows={2} label="A pensar…" />}
      {result && <AiAnswerView result={result.value} disclaimer={result.disclaimer} />}
    </section>
  )
}
