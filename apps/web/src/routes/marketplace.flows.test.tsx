import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks/data/users'
import { resetDb } from '@/mocks/db'
import { resetMarketplaceDb } from '@/mocks/marketplaceDb'
import { DEMO_PROFESSIONAL_PASSWORD, resetProfessionalDb } from '@/mocks/professionalDb'
import { paths } from './paths'
import { routes } from './router'

function renderAt(path: string) {
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

const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })

/** Login demo da família (monarca): sem sessão, a rota pedida redireciona para o login e volta a ela. */
async function loginFamily(path: string) {
  const router = renderAt(path)
  await screen.findByRole('heading', { name: 'Entrar' })
  type('E-mail', DEMO_EMAIL)
  type('Palavra-passe', DEMO_PASSWORD)
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  return router
}

/** Sessão de administrador da plataforma (mesmo mecanismo dos testes existentes). */
function signInAsAdmin(path: string) {
  window.sessionStorage.setItem('vf.session.userId', 'usr_platform_admin')
  return renderAt(path)
}

/** Login do portal do profissional com a palavra-passe demo; depois abre a rota pedida. */
async function loginProfessional(email: string, path: string) {
  const router = renderAt(paths.professionalLogin)
  await screen.findByRole('heading', { name: 'Entrar na área do profissional' })
  type(/E-mail/, email)
  type('Palavra-passe', DEMO_PROFESSIONAL_PASSWORD)
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  // O próprio login leva à área do profissional; só depois se abre a rota pedida (sem corrida com esse redirecionamento).
  await waitFor(() => expect(router.state.location.pathname).not.toBe(paths.professionalLogin))
  await router.navigate(path)
  return router
}

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  resetMarketplaceDb()
  window.sessionStorage.clear()
})

describe('mercado de profissionais (família)', () => {
  it('pesquisa: cartões, especialidade com «Novo» e comparação de dois profissionais', async () => {
    const router = await loginFamily(paths.marketplace)
    expect(await screen.findByText('Dra. Teresa Neto')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Especialidade'), { target: { value: 'spc_psico' } })
    await waitFor(() => expect(screen.getByLabelText('Especialidade')).toHaveValue('spc_psico'))
    expect((await screen.findAllByText('Novo')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Comparar Dra. Teresa Neto' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Comparar Carlos Baptista' }))
    fireEvent.click(screen.getByRole('button', { name: 'Comparar (2)' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/marketplace/comparar'))
    expect((await screen.findAllByText(/Kz/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Mais barato')).length).toBeGreaterThan(0)
  })

  it('«Como ordenamos» explica que o pagamento não influencia a ordem', async () => {
    await loginFamily(paths.marketplaceRanking)
    expect(await screen.findByRole('heading', { name: 'Como ordenamos' })).toBeInTheDocument()
    expect(await screen.findByText('O pagamento e os destaques pagos nunca influenciam a ordem.')).toBeInTheDocument()
  })

  it('perfil de profissional de Saúde: aviso de categoria e «Escrever» envia a primeira mensagem', async () => {
    const router = await loginFamily(paths.marketplaceProfessional('pro_pub_psico1'))
    expect(await screen.findByRole('heading', { name: 'Dra. Teresa Neto' })).toBeInTheDocument()
    expect(await screen.findByText('Não substitui atendimento de urgência.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Escrever' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Escrever para Dra. Teresa Neto')).toBeInTheDocument()
    expect(within(dialog).getByText('Não envie dados de saúde sensíveis por aqui; use a partilha com prazo.')).toBeInTheDocument()

    await waitFor(() => expect(within(dialog).getByLabelText('Para quem?')).toBeEnabled())
    fireEvent.change(within(dialog).getByLabelText('Para quem?'), { target: { value: 'mem_monarca' } })
    type('Primeira mensagem', 'Olá, gostava de marcar uma primeira consulta.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/messages\/mem_monarca\/.+/))
    expect(await screen.findByText('Olá, gostava de marcar uma primeira consulta.')).toBeInTheDocument()
  })

  it('lista de mensagens: abre a conversa seed, envia e vê a mensagem no log; suspenso só lê', async () => {
    await loginFamily(paths.messages)
    expect(await screen.findByText('Dra. Teresa Neto')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Dra. Teresa Neto'))
    const log = await screen.findByRole('log', { name: 'Mensagens' })
    expect(await within(log).findByText('Bom dia. Têm disponibilidade para uma primeira consulta online?')).toBeInTheDocument()

    type('Escrever mensagem', 'Obrigada, envio-lhe o horário preferido.')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await within(log).findByText('Obrigada, envio-lhe o horário preferido.')).toBeInTheDocument()

    // Conversa com profissional suspenso (cnv_seed_3): leitura sim, escrita não.
    cleanup()
    renderAt(paths.messageThread('mem_monarca', 'cnv_seed_3'))
    expect(await screen.findByText('Gostava de saber se faz planos alimentares para idosos.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Escrever mensagem')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Este profissional está indisponível. A conversa continua legível, mas já não aceita mensagens.'),
    ).toBeInTheDocument()
  })

  it('denúncia da família: motivo e envio, depois o admin decide ocultar a mensagem', async () => {
    await loginFamily(paths.messageThread('mem_monarca', 'cnv_seed_1'))
    const reportedText = 'Bom dia! Sim, tenho horários esta semana. Prefere de manhã ou à tarde?'
    expect(await screen.findByText(reportedText)).toBeInTheDocument()

    // A primeira «Denunciar» é da mensagem do profissional (a da família não se denuncia).
    fireEvent.click(screen.getAllByRole('button', { name: 'Denunciar' })[0]!)
    const reportDialog = await screen.findByRole('dialog')
    expect(within(reportDialog).getByText('Denunciar mensagem')).toBeInTheDocument()
    const submit = within(reportDialog).getByRole('button', { name: 'Enviar denúncia' })
    expect(submit).toBeDisabled()

    fireEvent.change(within(reportDialog).getByLabelText('Motivo'), { target: { value: 'ABUSE' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(await screen.findByText(/Denúncia enviada/)).toBeInTheDocument()

    // Admin: a fila «Por decidir» mostra a denúncia.
    cleanup()
    signInAsAdmin(paths.adminMessageReports)
    expect(await screen.findByRole('heading', { name: 'Denúncias de mensagens' })).toBeInTheDocument()
    expect(screen.getByLabelText('Estado')).toHaveValue('OPEN')
    fireEvent.click(await screen.findByRole('link', { name: /Abuso ou ofensas/ }))

    // Detalhe: contexto (mensagem anterior) e a mensagem denunciada.
    expect(await screen.findByRole('heading', { name: 'Denúncia de mensagem' })).toBeInTheDocument()
    expect(await screen.findByText('Bom dia. Têm disponibilidade para uma primeira consulta online?')).toBeInTheDocument()
    expect(screen.getByText(reportedText)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar mensagem' }))
    const confirm = await screen.findByRole('dialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Ocultar mensagem' }))

    expect(await screen.findByText('Decidida')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ocultar mensagem' })).not.toBeInTheDocument()
  })

  it('profissional aprovada (Marta Lopes) vê a família como «Monarca» e responde na conversa', async () => {
    const router = await loginProfessional('marta.lopes@exemplo.ao', paths.professionalConversations)
    expect(router.state.location.pathname).toBe(paths.professionalConversations)
    fireEvent.click(await screen.findByRole('link', { name: /Monarca/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(paths.professionalConversation('cnv_seed_4')))
    const log = await screen.findByRole('log', { name: 'Mensagens' })
    expect(await within(log).findByText('E tem aulas ao fim de semana?')).toBeInTheDocument()

    type('Escrever mensagem', 'Sim, temos aulas ao sábado de manhã.')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await within(log).findByText('Sim, temos aulas ao sábado de manhã.')).toBeInTheDocument()
  })

  it('profissional suspenso (Rui Tavares) lê a conversa e não tem campo de escrita', async () => {
    const router = await loginProfessional('rui.tavares@exemplo.ao', paths.professionalConversations)
    fireEvent.click(await screen.findByRole('link', { name: /Monarca/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(paths.professionalConversation('cnv_seed_3')))
    expect(await screen.findByText('Sim, faço. Podemos marcar uma avaliação inicial.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Escrever mensagem')).not.toBeInTheDocument()
    expect(await screen.findByText('A sua conta já não está aprovada: as conversas ficam só de leitura.')).toBeInTheDocument()
  })
})
