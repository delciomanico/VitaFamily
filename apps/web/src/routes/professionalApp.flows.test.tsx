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
