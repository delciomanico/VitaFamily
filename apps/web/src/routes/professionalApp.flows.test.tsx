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

/** App móvel do profissional: barra inferior, Início, separador Perfil e avatar. Sessão demonstrativa `pro_aprovada` (Marta Lopes). */
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

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  resetMarketplaceDb()
  resetConsultationsDb()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('barra inferior do portal do profissional', () => {
  it('tem 4 separadores com texto, marca o ativo e navega sem recarregar', async () => {
    const router = asProfessional('/profissional')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => /(Início|Marcações|Conversas|Perfil)$/.exec(link.textContent ?? '')?.[1])).toEqual(['Início', 'Marcações', 'Conversas', 'Perfil'])
    expect(within(nav).getByRole('link', { name: /Início/ })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Marcações/ })).not.toHaveAttribute('aria-current')

    fireEvent.click(within(nav).getByRole('link', { name: /Marcações/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional/marcacoes'))
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Marcações/ })).toHaveAttribute('aria-current', 'page'))
    expect(within(nav).getByRole('link', { name: /Início/ })).not.toHaveAttribute('aria-current')
  })

  it('as áreas do perfil (serviços, horários…) mantêm «Perfil» como separador ativo', async () => {
    asProfessional('/profissional/servicos')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    expect(within(nav).getByRole('link', { name: /Perfil/ })).toHaveAttribute('aria-current', 'page')
  })

  it('é navegável por teclado: ligações reais, na ordem visual, que aceitam foco', async () => {
    asProfessional('/profissional')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    for (const link of within(nav).getAllByRole('link')) {
      expect(link).toHaveAttribute('href')
      expect(link.tabIndex).toBeGreaterThanOrEqual(0)
      link.focus()
      expect(document.activeElement).toBe(link)
    }
  })

  it('o separador Conversas mostra as mensagens por ler', async () => {
    asProfessional('/profissional')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    expect(await within(nav).findByRole('link', { name: /Conversas, \d+ por ler/ })).toBeInTheDocument()
  })
})

describe('Início', () => {
  it('saúda pelo nome e mostra um só próximo passo; o resto fica recolhido', async () => {
    asProfessional('/profissional')
    expect(await screen.findByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Marta$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Próximas marcações' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/REQUESTED|CONFIRMED|DISPUTED|SUBMITTED|PENDING_REVIEW|DRAFT/)
  })

  it('«Ver tudo o que falta» só abre a lista quando se toca', async () => {
    asProfessional('/profissional', 'pro_demo')
    const toggle = await screen.findByRole('button', { name: /Ver tudo o que falta/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('cidade')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('cidade')).toBeInTheDocument()
  })
})

describe('separador Perfil', () => {
  it('lista as áreas em entradas grandes, com estado, e o avatar mostra as iniciais', async () => {
    asProfessional('/profissional/perfil')
    expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeInTheDocument()
    const areas = await screen.findByRole('navigation', { name: 'Áreas do perfil' })
    expect(within(areas).getByRole('link', { name: /Os meus serviços/ })).toHaveAttribute('href', '/profissional/servicos')
    expect(within(areas).getByRole('link', { name: /Os meus horários/ })).toHaveAttribute('href', '/profissional/horarios')
    expect(within(areas).getByRole('link', { name: /Os meus documentos/ })).toHaveAttribute('href', '/profissional/credenciais')
    expect(within(areas).getByRole('link', { name: /Avaliações/ })).toHaveAttribute('href', '/profissional/avaliacoes')
    expect(within(areas).getByRole('link', { name: /Registos partilhados consigo/ })).toHaveAttribute('href', '/profissional/partilhas')
    await waitFor(() => expect(within(areas).getByRole('link', { name: /Os meus serviços/ })).toHaveTextContent(/serviço/))
    expect(screen.getAllByRole('img', { name: 'Marta Lopes' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('img', { name: 'Marta Lopes' })[0]).toHaveTextContent('ML')
  })

  it('foto opcional: ao escolher uma imagem o avatar (também na barra inferior) passa a mostrá-la; dá para a tirar', async () => {
    asProfessional('/profissional/perfil')
    const input = (await screen.findByLabelText(/Adicionar foto/)) as HTMLInputElement
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'eu.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Marta Lopes' }).every((el) => el.tagName === 'IMG')).toBe(true))
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).getByRole('img', { name: 'Marta Lopes' }).tagName).toBe('IMG')

    fireEvent.click(screen.getByRole('button', { name: 'Tirar a foto' }))
    await waitFor(() => expect(within(nav).getByRole('img', { name: 'Marta Lopes' })).toHaveTextContent('ML'))
  })

  it('«Sair» pede confirmação com «Sim» e «Não» e leva ao ecrã de entrada', async () => {
    const router = asProfessional('/profissional/perfil')
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Não' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, sair' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'))
    cleanup()
  })
})

describe('Marcações', () => {
  it('filtros em pílulas (um ativo de cada vez) e lista agrupada por dia', async () => {
    asProfessional('/profissional/marcacoes')
    const group = await screen.findByRole('group', { name: 'Mostrar marcações' })
    expect(within(group).getByRole('button', { name: 'Próximas' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Pai do Pedro')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Concluídas' }))
    expect(within(group).getByRole('button', { name: 'Concluídas' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Próximas' })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(screen.queryByText('Pai do Pedro')).not.toBeInTheDocument())
  })

  it('estado vazio amigável com uma ação', async () => {
    asProfessional('/profissional/marcacoes')
    fireEvent.click(await screen.findByRole('button', { name: 'Recusadas' }))
    expect(await screen.findByText('Não recusou nenhum pedido.')).toBeInTheDocument()
  })

  it('detalhe: resumo no topo, um só passo («O que falta fazer») e secções recolhidas que se abrem ao toque', async () => {
    asProfessional('/profissional/marcacoes/bkg_seed_pa_conf')
    expect(await screen.findByRole('heading', { name: 'O que falta fazer' })).toBeInTheDocument()
    expect(screen.getByLabelText('Resumo da marcação')).toHaveTextContent('Confirmada')
    const payment = screen.getByRole('button', { name: /^Pagamento/ })
    // Há um comprovativo por analisar: a secção relevante já vem aberta.
    expect(payment).toHaveAttribute('aria-expanded', 'true')
    const share = screen.getByRole('button', { name: /^Partilha de registos/ })
    expect(share).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Ver partilhas desta marcação' })).not.toBeInTheDocument()
    fireEvent.click(share)
    expect(share).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Ver partilhas desta marcação' })).toHaveAttribute('href', '/profissional/partilhas?marcacao=bkg_seed_pa_conf')
    fireEvent.click(payment)
    expect(payment).toHaveAttribute('aria-expanded', 'false')
    expect(document.body.textContent).not.toMatch(/\b(REQUESTED|CONFIRMED|DISPUTED|SUBMITTED|COMPLETED|NO_SHOW)\b/)
  })

  it('confirmar o pagamento pede «Sim» ou «Não»; «Não» não faz nada', async () => {
    asProfessional('/profissional/marcacoes/bkg_seed_pa_conf')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar pagamento' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Confirmar que recebeu o pagamento?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Não' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeInTheDocument()
    expect(screen.queryByText('Pagamento confirmado')).not.toBeInTheDocument()
  })

  it('recusar um pedido exige motivo e usa «Sim, recusar»', async () => {
    asProfessional('/profissional/marcacoes/bkg_seed_pa_req')
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, recusar' }))
    expect(await within(dialog).findByText('Preencha este campo.')).toBeInTheDocument()
  })
})

describe('Conversas', () => {
  it('lista simples: avatar, nome, estado da última mensagem, hora e bolinha de não lida', async () => {
    asProfessional('/profissional/conversas')
    const link = await screen.findByRole('link', { name: /Monarca/ })
    expect(within(link).getByRole('img', { name: 'Monarca' })).toHaveTextContent('M')
    expect(within(link).getByRole('img', { name: /por ler/ })).toBeInTheDocument()
    expect(within(link).getByText(/mensagem(ns)? nova/)).toBeInTheDocument()
    expect(link.querySelector('time')).not.toBeNull()
    expect(link).toHaveAttribute('href', '/profissional/conversas/cnv_seed_4')
  })

  it('conversa em ecrã inteiro: sem barra inferior, caixa de escrita e «Enviar»; aviso de privacidade recolhível', async () => {
    asProfessional('/profissional/conversas/cnv_seed_4')
    const log = await screen.findByRole('log', { name: 'Mensagens' })
    expect(await within(log).findByText('E tem aulas ao fim de semana?')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Escrever mensagem')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()

    expect(screen.getByText(/Não envie dados de saúde sensíveis/)).toBeInTheDocument()
    const more = screen.getByRole('button', { name: /Saber mais/ })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/só vê uma mensagem se alguém a denunciar/)).toBeInTheDocument()
  })

  it('fechar a conversa pede «Sim» ou «Não»', async () => {
    asProfessional('/profissional/conversas/cnv_seed_4')
    await screen.findByRole('log', { name: 'Mensagens' })
    fireEvent.click(await screen.findByRole('button', { name: 'Opções' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fechar a conversa' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Fechar esta conversa?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, fechar' }))
    expect(await screen.findByText('Conversa fechada.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Escrever mensagem')).not.toBeInTheDocument())
  })
})
