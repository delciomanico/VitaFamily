import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import { resetConsultationsDb } from '@/mocks/consultationsDb'
import { resetMarketplaceDb } from '@/mocks/marketplaceDb'
import { resetProfessionalDb } from '@/mocks/professionalDb'
import { routes } from './router'

/** Passo a passo do portal do profissional: progresso, «Voltar» com rascunho, «Continuar» e a ação final. */
function asProfessional(path: string, accountId = 'pro_aprovada') {
  window.sessionStorage.setItem('vf.professional.session.accountId', accountId)
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
const next = (name: string | RegExp = 'Continuar') => fireEvent.click(screen.getByRole('button', { name }))
const progress = () => screen.getByRole('progressbar')

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  resetMarketplaceDb()
  resetConsultationsDb()
  window.sessionStorage.clear()
})

describe('novo serviço (passo a passo)', () => {
  it('um assunto por ecrã, com progresso, sem barra inferior; cria o serviço no fim', async () => {
    const router = asProfessional('/profissional/servicos/novo')
    expect(await screen.findByRole('heading', { name: 'O que oferece?' })).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuetext', 'Passo 1 de 5')
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
    // Só um assunto: nada do preço ou da duração aparece ainda.
    expect(screen.queryByLabelText('Preço (Kz)')).not.toBeInTheDocument()

    // Com uma só especialidade, já vem escolhida.
    expect(screen.getByRole('radio', { name: /Yoga/ })).toBeChecked()
    next()
    expect(await screen.findByRole('heading', { name: 'Como atende?' })).toBeInTheDocument()
    // Continuar sem escolher dá uma mensagem humana e não avança.
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha como atende.')
    expect(progress()).toHaveAttribute('aria-valuenow', '2')
    fireEvent.click(screen.getByRole('radio', { name: /Vídeo/ }))
    next()
    fireEvent.click(await screen.findByRole('radio', { name: '30 min' }))
    next()
    expect(await screen.findByRole('heading', { name: 'Quanto custa?' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escreva o preço em Kwanza')
    type('Preço (Kz)', '5000')
    next()
    expect(await screen.findByRole('heading', { name: 'Quer deixar uma nota?' })).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuetext', 'Passo 5 de 5')
    expect(screen.getByLabelText('Resumo do serviço')).toHaveTextContent(/Yoga.*Vídeo · 30 min.*5\s?000/s)
    next('Guardar serviço')

    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional/servicos'))
    expect(await screen.findByText('Serviço criado.')).toBeInTheDocument()
    expect(await screen.findByText(/Vídeo · 30 min/)).toBeInTheDocument()
  })

  it('«Voltar» está sempre disponível e o que foi escrito fica guardado (rascunho, mesmo ao sair e voltar)', async () => {
    asProfessional('/profissional/servicos/novo')
    fireEvent.click(await screen.findByRole('radio', { name: /Yoga/ }))
    next()
    fireEvent.click(await screen.findByRole('radio', { name: /Telefone/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'O que oferece?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Yoga/ })).toBeChecked()
    next()
    expect(await screen.findByRole('radio', { name: /Telefone/ })).toBeChecked()

    // Sai a meio (desmonta) e volta: o rascunho recupera as escolhas.
    cleanup()
    asProfessional('/profissional/servicos/novo')
    expect(await screen.findByRole('radio', { name: /Yoga/ })).toBeChecked()
  })

  it('um serviço igual a um já ativo mostra uma mensagem simples', async () => {
    asProfessional('/profissional/servicos/novo')
    fireEvent.click(await screen.findByRole('radio', { name: /Yoga/ }))
    next()
    fireEvent.click(await screen.findByRole('radio', { name: /Presencial/ }))
    next()
    fireEvent.click(await screen.findByRole('radio', { name: '60 min' }))
    next()
    await screen.findByLabelText('Preço (Kz)')
    type('Preço (Kz)', '1000')
    next()
    next('Guardar serviço')
    expect(await screen.findByRole('alert')).toHaveTextContent('Já tem um serviço ativo com esta especialidade, método e duração.')
  })
})

describe('serviços: confirmações em folha', () => {
  it('desativar pede «Sim» ou «Não»; mudar o preço abre uma folha com um campo', async () => {
    asProfessional('/profissional/servicos')
    fireEvent.click(await screen.findByRole('button', { name: /Desativar serviço de Yoga/ }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Desativar este serviço?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Não' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Mudar preço e nota de Yoga/ }))
    dialog = await screen.findByRole('dialog')
    type('Preço (Kz)', '18000')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Serviço guardado.')).toBeInTheDocument()
    expect(await screen.findByText(/18\s?000 Kz/)).toBeInTheDocument()
  })
})

describe('os meus dados (passo a passo)', () => {
  it('5 passos: nome, cidade, especialidades, biografia e pagamento; guarda no fim', async () => {
    asProfessional('/profissional/perfil/editar', 'pro_demo')
    expect(await screen.findByRole('heading', { name: 'Como se chama?' })).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuetext', 'Passo 1 de 5')
    type(/Nome de apresentação/, ' ')
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escreva o seu nome')
    type(/Nome de apresentação/, 'Helena Cardoso')
    next()
    expect(await screen.findByRole('heading', { name: 'Onde trabalha?' })).toBeInTheDocument()
    type('Cidade', 'Luanda')
    next()
    expect(await screen.findByRole('heading', { name: 'O que faz?' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha pelo menos uma especialidade.')
    fireEvent.click(screen.getByRole('checkbox', { name: /Yoga/ }))
    next()
    expect(await screen.findByRole('heading', { name: 'Fale um pouco de si' })).toBeInTheDocument()
    type('Biografia', 'Professora de yoga.')
    next()
    expect(await screen.findByRole('heading', { name: 'Como quer ser pago?' })).toBeInTheDocument()
    next('Guardar')
    expect(await screen.findByText('Perfil guardado.')).toBeInTheDocument()
  })

  it('aprovado: o nome fica bloqueado e há um aviso simples', async () => {
    asProfessional('/profissional/perfil/editar')
    expect(await screen.findByLabelText(/Nome de apresentação/)).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent('peça ao administrador')
  })
})

describe('novo horário (passo a passo)', () => {
  it('serviço, dias, horas e validade; guarda e volta à lista', async () => {
    const router = asProfessional('/profissional/horarios/novo')
    expect(await screen.findByRole('heading', { name: 'Para que serviço?' })).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuetext', 'Passo 1 de 4')
    fireEvent.click(screen.getByRole('radio', { name: /Yoga/ }))
    next()
    expect(await screen.findByRole('heading', { name: 'Em que dias atende?' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha pelo menos um dia da semana.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Segunda' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Quarta' }))
    next()
    expect(await screen.findByRole('heading', { name: 'A que horas?' })).toBeInTheDocument()
    type('Começa às', '09:00')
    type('Acaba às', '09:30')
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos 60 minutos')
    type('Acaba às', '12:00')
    next()
    expect(await screen.findByRole('heading', { name: 'Até quando vale?' })).toBeInTheDocument()
    next('Guardar horário')
    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional/horarios'))
    expect(await screen.findByText('09:00 – 12:00')).toBeInTheDocument()
    expect(screen.getByText('Segunda, Quarta')).toBeInTheDocument()
  })

  it('a lista de horários tem pausas e horários livres recolhidos', async () => {
    asProfessional('/profissional/horarios')
    const pauses = await screen.findByRole('button', { name: /^Pausas e férias/ })
    expect(pauses).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Horários livres/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(pauses)
    expect(await screen.findByRole('link', { name: 'Adicionar pausa' })).toHaveAttribute('href', '/profissional/horarios/pausa')
  })
})

describe('enviar documento (passo a passo)', () => {
  it('tipo, ficheiro e dados opcionais; o documento aparece na lista', async () => {
    const router = asProfessional('/profissional/credenciais/novo', 'pro_demo')
    expect(await screen.findByRole('heading', { name: 'Que documento é?' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha o tipo de documento.')
    fireEvent.click(screen.getByRole('radio', { name: /Identificação/ }))
    next()
    expect(await screen.findByRole('heading', { name: 'Escolha o ficheiro' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha o ficheiro a enviar.')
    const file = new File(['%PDF-1.4'], 'bi.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Ficheiro'), { target: { files: [file] } })
    expect(await screen.findByText(/bi\.pdf/)).toBeInTheDocument()
    next()
    expect(await screen.findByRole('heading', { name: 'Mais alguns dados' })).toBeInTheDocument()
    next('Enviar documento')
    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional/credenciais'))
    expect(await screen.findByText('Documento enviado. Está em verificação.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Identificação' })).toBeInTheDocument()

    // Remover pede confirmação com «Sim»/«Não».
    fireEvent.click(screen.getByRole('button', { name: /Remover Identificação/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Sim, remover' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Não' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Identificação' })).toBeInTheDocument()
  })
})
