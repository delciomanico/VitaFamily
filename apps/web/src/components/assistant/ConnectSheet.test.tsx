import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError, PROVIDERS, setProviderOverrideForTests } from '@/lib/ai/providers'
import { aiService } from '@/services/ai.service'
import { ConnectSheet } from './ConnectSheet'

vi.mock('@/lib/apiClient', async (original) => ({ ...(await original<typeof import('@/lib/apiClient')>()), hasApiBackend: () => true }))
vi.mock('@/lib/ai/google', async (original) => ({ ...(await original<typeof import('@/lib/ai/google')>()), requestGoogleToken: () => Promise.resolve('ya29.teste') }))

const gemini = PROVIDERS.find((p) => p.id === 'GEMINI')!

function connect() {
  const onConnected = vi.fn()
  const grant = vi.spyOn(aiService, 'grantConsent').mockResolvedValue({} as never)
  render(<ConnectSheet open onClose={() => undefined} provider={gemini} member={{ id: 'mem_1', name: 'Ana', isSelf: true }} familyId="fam_1" onConnected={onConnected} />)
  fireEvent.click(screen.getByRole('checkbox', { hidden: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar com Google', hidden: true }))
  return { onConnected, grant }
}

describe('ligar o fornecedor: teste de ligação', () => {
  afterEach(() => {
    cleanup()
    setProviderOverrideForTests(undefined)
    vi.restoreAllMocks()
  })

  it.each([429, 503])('fornecedor ocupado (%i): a credencial foi aceite, a ligação fica feita', async (status) => {
    setProviderOverrideForTests(() => Promise.reject(new ProviderError('QUOTA', status)))
    const { onConnected, grant } = connect()
    await waitFor(() => expect(onConnected).toHaveBeenCalled())
    expect(grant).toHaveBeenCalledTimes(1)
  })

  it('credencial recusada (403): não regista consentimento e diz o código', async () => {
    setProviderOverrideForTests(() => Promise.reject(new ProviderError('AUTH', 403)))
    const { onConnected, grant } = connect()
    expect(await screen.findByText(/código 403/)).toBeInTheDocument()
    expect(grant).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })
})
