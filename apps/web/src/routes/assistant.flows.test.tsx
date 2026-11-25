import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetAssistantForTests } from '@/lib/ai/assistant'
import { setProviderOverrideForTests } from '@/lib/ai/providers'
import { mockOutcomes } from '@/mocks/handlers/ai'
import { resetDb } from '@/mocks/db'
import { aiService } from '@/services/ai.service'
import { paths } from './paths'
import { routes } from './router'

function renderAt(path: string, userId = 'usr_monarca') {
  window.sessionStorage.setItem('vf.session.userId', userId)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>,
  )
  return router
}

const GOOD = JSON.stringify({
  summary: 'Os números mostram uma adesão estável.',
  observations: ['Houve uma semana mais baixa.'],
  generalGuidance: ['Manter o registo ajuda a ver a evolução.'],
  suggestedSpecialty: '0e8e0bb5-7a41-4c0e-8a61-1d5d9a0c2b02',
  urgency: 'ROUTINE',
})

beforeEach(() => {
  resetDb()
  aiService.resetForTests()
  resetAssistantForTests()
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  setProviderOverrideForTests(undefined)
})

/** Liga o Claude (modo demonstração: sem chave real) e devolve o router. */
async function connect() {
  const router = renderAt(paths.assistant)
  expect(await screen.findByRole('heading', { name: 'Assistente Vita' })).toBeInTheDocument()
  const row = (await screen.findByText('Claude (Anthropic)')).closest('li') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Ligar' }))
  const sheet = await screen.findByRole('dialog', { name: /Ligar Claude/ })
  return { router, sheet }
}

describe('Assistente Vita (UC-AI-01/04)', () => {
  it('aparece nas Definições e abre a página; sem consentimento o botão de ligar está desativado', async () => {
    renderAt(paths.settings)
    fireEvent.click(await screen.findByRole('link', { name: /Assistente Vita/ }))
    expect(await screen.findByRole('heading', { name: 'Assistente Vita' })).toBeInTheDocument()
    const { sheet } = await (async () => {
      const row = (await screen.findByText('Claude (Anthropic)')).closest('li') as HTMLElement
      fireEvent.click(within(row).getByRole('button', { name: 'Ligar' }))
      return { sheet: await screen.findByRole('dialog', { name: /Ligar Claude/ }) }
    })()
    // O consentimento nomeia o fornecedor e diz que os dados saem da Vita Family.
    expect(within(sheet).getByText(/saem da Vita Family e seguem diretamente deste aparelho para a Anthropic/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Ligar com esta chave' })).toBeDisabled()
  })

  it('liga com consentimento explícito e desliga (a chave e o consentimento saem)', async () => {
    await connect()
    const dialog = screen.getByRole('dialog', { name: /Ligar Claude/ })
    fireEvent.input(within(dialog).getByLabelText('Chave de API'), { target: { value: 'sk-ant-demo-123456' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /aceito que os dados saiam da Vita Family para a Anthropic/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ligar com esta chave' }))
    expect(await screen.findByText('Ligado')).toBeInTheDocument()
    expect((await aiService.listConsents('fam_monarca', 'mem_monarca')).filter((c) => c.revokedAt === null)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Desligar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, desligar' }))
    await waitFor(() => expect(screen.queryByText('Ligado')).not.toBeInTheDocument())
  })

  it('chave curta não avança e nada é registado', async () => {
    await connect()
    const dialog = screen.getByRole('dialog', { name: /Ligar Claude/ })
    fireEvent.input(within(dialog).getByLabelText('Chave de API'), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ligar com esta chave' }))
    expect(await within(dialog).findByText('Cole a chave de API completa.')).toBeInTheDocument()
    expect((await aiService.listConsents('fam_monarca', 'mem_monarca')).filter((c) => c.revokedAt === null)).toHaveLength(0)
  })
})

describe('Tenho sintomas (UC-AI-03)', () => {
  async function connected() {
    await aiService.grantConsent('fam_monarca', 'mem_monarca', 'CLAUDE', 'v1')
    renderAt(paths.assistantSymptoms)
    return screen.findByRole('textbox', { name: /O que está a sentir/ })
  }

  it('sem IA ligada pede para ligar primeiro', async () => {
    renderAt(paths.assistantSymptoms)
    expect(await screen.findByText('Ligue primeiro uma IA')).toBeInTheDocument()
  })

  it('sinal de alarme: mostra a mensagem de urgência (sem análise) e o aviso de emergência fica sempre visível', async () => {
    setProviderOverrideForTests(() => Promise.reject(new Error('não devia ser chamado')))
    const box = await connected()
    expect(screen.getByRole('note')).toHaveTextContent(/emergência/i)
    fireEvent.input(box, { target: { value: 'Tenho dor forte no peito e falta de ar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Procure ajuda agora/)
    expect(screen.getByRole('alert')).toHaveTextContent(/urgência/)
  })

  it('resposta válida: mostra orientação geral, o aviso permanente e «Ver profissionais» com a especialidade do catálogo', async () => {
    setProviderOverrideForTests(() => Promise.resolve(GOOD))
    const box = await connected()
    fireEvent.input(box, { target: { value: 'Tosse seca há dois dias' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar' }))
    expect(await screen.findByText('Os números mostram uma adesão estável.')).toBeInTheDocument()
    expect(screen.getByText(/Informação geral gerada por IA; não é um diagnóstico/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Ver profissionais' })
    expect(link).toHaveAttribute('href', `${paths.marketplace}?especialidade=0e8e0bb5-7a41-4c0e-8a61-1d5d9a0c2b02`)
    expect(link.getAttribute('href')).not.toMatch(/Tosse|sintoma/i) // nenhum dado de saúde no URL
    await waitFor(() => expect(mockOutcomes().at(-1)?.outcome).toBe('COMPLETED'))
  })

  it('resposta com medicamento ⇒ «Sem resposta» (nunca o texto do modelo)', async () => {
    setProviderOverrideForTests(() => Promise.resolve(JSON.stringify({ summary: 'Tome paracetamol 500 mg.', observations: [], generalGuidance: [], urgency: 'NONE' })))
    const box = await connected()
    fireEvent.input(box, { target: { value: 'Dor de cabeça ligeira' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar' }))
    expect(await screen.findByText('Sem resposta')).toBeInTheDocument()
    expect(screen.queryByText(/paracetamol/)).not.toBeInTheDocument()
  })
})

describe('Explicar com IA no Resumo de saúde (UC-AI-02, BR-AI-15)', () => {
  it('só com IA ligada; a explicação aparece junto dos números, com o aviso', async () => {
    setProviderOverrideForTests(() => Promise.resolve(GOOD))
    renderAt(paths.healthSummary)
    expect(await screen.findByText('Explicação com IA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ligar agora' })).toHaveAttribute('href', paths.assistant)
    cleanup()

    await aiService.grantConsent('fam_monarca', 'mem_monarca', 'CLAUDE', 'v1')
    renderAt(paths.healthSummary)
    fireEvent.click(await screen.findByRole('button', { name: /Explicar com Claude/ }))
    expect(await screen.findByText('Os números mostram uma adesão estável.')).toBeInTheDocument()
    expect(screen.getByText(/Informação geral gerada por IA/)).toBeInTheDocument()
    // Os números em bruto do mesmo Resumo continuam no ecrã.
    expect(screen.getByText('Medicamentos tomados')).toBeInTheDocument()
  })
})
