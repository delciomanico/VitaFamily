import { useState } from 'react'
import { Sheet } from '@/components/app/Sheet'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { hasApiBackend } from '@/lib/apiClient'
import { requestGoogleToken } from '@/lib/ai/google'
import { keyStore } from '@/lib/ai/keyStore'
import { callProvider, ProviderError, providerLabel, type ProviderInfo } from '@/lib/ai/providers'
import { CONSENT_VERSION, consentIntro, consentPoints, minorNotice, providerOwner } from '@/lib/ai/texts'
import { aiService, type AiMember } from '@/services/ai.service'

interface Props {
  open: boolean
  onClose: () => void
  provider: ProviderInfo
  member: AiMember
  familyId: string
  /** Chamado depois de o consentimento ficar registado. */
  onConnected: () => void
}

/** Texto pt-PT para uma falha do teste de ligação (nunca inclui o corpo da resposta do fornecedor). */
function testMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.failure === 'AUTH') return `O fornecedor não aceitou a chave. Confirme-a e tente de novo.${error.status ? ` (código ${error.status})` : ''}`
    if (error.failure === 'FAILED' && error.status) return `O fornecedor recusou o pedido (código ${error.status}). Confirme a chave e o acesso ao modelo.`
    if (error.failure === 'QUOTA') return 'O fornecedor atingiu o limite de pedidos. Tente mais tarde.'
    if (error.failure === 'NETWORK') return 'Não foi possível contactar o fornecedor. Verifique a ligação.'
  }
  const message = error instanceof Error ? error.message : ''
  if (message === 'OAUTH_CANCELLED' || message === 'POPUP_BLOCKED') return 'A autorização da Google não foi concluída. Tente de novo.'
  if (message === 'GOOGLE_NOT_CONFIGURED') return 'A ligação com a Google ainda não está disponível.'
  return 'Não foi possível ligar. Tente de novo.'
}

/**
 * Ligar um fornecedor e consentir (UC-AI-01, BR-AI-01..03): o consentimento NOMEIA o fornecedor e diz que os dados saem da Vita Family. A chave só é
 * guardada (cifrada, neste aparelho) e o consentimento só é registado no servidor DEPOIS de a ligação ser testada com um pedido sem dados de saúde.
 */
export function ConnectSheet({ open, onClose, provider, member, familyId, onConnected }: Props) {
  const [agreed, setAgreed] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsKey = provider.connect === 'apiKey'
  const label = providerLabel(provider.id)
  const who = member.isSelf ? 'os seus' : `os de ${member.name.split(' ')[0] ?? member.name}`

  async function connect() {
    setError(null)
    if (needsKey && apiKey.trim().length < 8) return setError('Cole a chave de API completa.')
    setBusy(true)
    try {
      const real = hasApiBackend()
      if (needsKey) {
        if (real && !keyStore().supported()) throw new Error('Este aparelho não permite guardar a chave com segurança.')
        // Teste mínimo, sem dados de saúde.
        if (real) await callProvider(provider.id, { kind: 'apiKey', key: apiKey.trim() }, { system: 'Responde apenas com a palavra: ok', user: 'ok' })
        if (real) await keyStore().save(provider.id, apiKey.trim())
      } else if (real) {
        const token = await requestGoogleToken()
        await callProvider(provider.id, { kind: 'token', token }, { system: 'Responde apenas com a palavra: ok', user: 'ok' })
      }
      await aiService.grantConsent(familyId, member.id, provider.id, CONSENT_VERSION)
      setApiKey('')
      setAgreed(false)
      onConnected()
    } catch (err) {
      setError(testMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Ligar ${label}`}
      description={consentIntro(label, providerOwner[provider.id], who)}
      stickyFooter
      footer={
        <>
          <Button size="xl" fullWidth loading={busy} disabled={!agreed} onClick={() => void connect()}>
            {needsKey ? 'Ligar com esta chave' : 'Continuar com Google'}
          </Button>
          <Button variant="ghost" size="lg" fullWidth onClick={onClose} disabled={busy}>
            Agora não
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-2 ps-5 text-base">
        {consentPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
        {!member.isSelf && <li>{minorNotice}</li>}
      </ul>
      {needsKey && (
        <div className="flex flex-col gap-2">
          <PasswordInput label="Chave de API" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} hint={provider.keyHelp} />
        </div>
      )}
      <Checkbox
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        label={`Li e aceito que os dados saiam da Vita Family para ${providerOwner[provider.id]}.`}
      />
      <FormError message={error} />
    </Sheet>
  )
}
