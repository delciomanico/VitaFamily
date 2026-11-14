import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
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

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})
afterEach(cleanup)

describe('site público (F0.2)', () => {
  it('mostra a landing em / a quem não tem sessão', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /saúde de toda a família/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Entrar' }).length).toBeGreaterThan(0)
  })

  it('o hub de entrada leva a cada portal', async () => {
    renderAt('/entrar')
    const main = within(await screen.findByRole('main'))
    expect(await main.findByRole('link', { name: /entrar como família/i })).toHaveAttribute('href', '/login')
    expect(main.getByRole('link', { name: /entrar como clínica/i })).toHaveAttribute('href', '/clinic/login')
    expect(main.getByRole('link', { name: /entrar como seguradora/i })).toHaveAttribute('href', '/insurance/login')
    expect(main.getByRole('link', { name: /entrar como backoffice/i })).toHaveAttribute('href', '/backoffice')
  })

  it('quem tem sessão continua a ver o site, com «Abrir a app»', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    const router = renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /saúde de toda a família/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('link', { name: 'Abrir a app' })).toHaveAttribute('href', '/app')
  })

  it('as páginas públicas não expulsam quem tem sessão', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    for (const path of ['/faq', '/contacto', '/entrar', '/termos', '/privacidade']) {
      const router = renderAt(path)
      await screen.findByRole('main')
      expect(router.state.location.pathname).toBe(path)
      cleanup()
    }
  })

  it('o pedido de acesso valida os campos e compõe o e-mail', async () => {
    renderAt('/solicitar-acesso/clinica')
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Indique o nome da entidade.')).toBeInTheDocument()
  })

  it('um tipo de pedido desconhecido volta ao hub', async () => {
    const router = renderAt('/solicitar-acesso/outro')
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'))
  })

  it('clínicas e seguradoras têm página própria com pedido de acesso', async () => {
    renderAt('/clinicas')
    expect(await screen.findByRole('heading', { level: 1, name: /agenda cheia/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Solicitar acesso' })[0]).toHaveAttribute('href', '/solicitar-acesso/clinica')
    cleanup()
    renderAt('/seguradoras')
    expect(await screen.findByRole('heading', { level: 1, name: /beneficiários e clínicas/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Solicitar acesso' })[0]).toHaveAttribute('href', '/solicitar-acesso/seguradora')
  })

  it('a pesquisa pública da rede de prestadores filtra por texto (sem acentos) e por tipo', async () => {
    renderAt('/rede-de-prestadores')
    expect(await screen.findByText('9 prestadores encontrados')).toBeInTheDocument()
    expect(screen.getByText('A mostrar 1–5 de 9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Página seguinte' }))
    expect(await screen.findByText('A mostrar 6–9 de 9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar prestadores' }), { target: { value: 'pediatria' } })
    expect(await screen.findByText('3 prestadores encontrados')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar prestadores' }), { target: { value: 'seguradora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seguradoras' }))
    expect(await screen.findByText('2 prestadores encontrados')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar prestadores' }), { target: { value: 'xyz' } })
    expect(await screen.findByText('Nenhum prestador corresponde à pesquisa')).toBeInTheDocument()
  })

  it('o backoffice leva o administrador à sua área e recusa as outras contas', async () => {
    const router = renderAt('/backoffice')
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'admin@vitafamily.app' } })
    fireEvent.change(screen.getByLabelText('Palavra-passe'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no backoffice' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
    cleanup()
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    const family = renderAt('/backoffice')
    expect(await screen.findByText('Esta conta não tem acesso ao backoffice.')).toBeInTheDocument()
    expect(family.state.location.pathname).toBe('/backoffice')
  })

  it('o endereço antigo /parceiros redireciona para a rede de prestadores', async () => {
    const router = renderAt('/parceiros')
    await waitFor(() => expect(router.state.location.pathname).toBe('/rede-de-prestadores'))
  })

  it('a FAQ filtra por categoria e por texto; o contacto valida o formulário', async () => {
    renderAt('/faq')
    await screen.findByRole('heading', { level: 1, name: 'Como podemos ajudar?' })
    expect(screen.getAllByRole('group', { name: 'Categoria' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Seguradoras' }))
    expect(await screen.findByText('Tenho de migrar o meu sistema?')).toBeInTheDocument()
    expect(screen.queryByText('Funciona no telemóvel?')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar nas perguntas' }), { target: { value: 'zzzz' } })
    expect(await screen.findByText('Nenhuma pergunta encontrada')).toBeInTheDocument()
    cleanup()
    renderAt('/contacto')
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar mensagem' }))
    expect(await screen.findByText('Indique o seu nome.')).toBeInTheDocument()
    expect(screen.getByText('Escolha um assunto.')).toBeInTheDocument()
  })

  it('FAQ, termos, privacidade e contacto estão acessíveis sem sessão', async () => {
    renderAt('/faq')
    expect(await screen.findByRole('heading', { level: 1, name: 'Como podemos ajudar?' })).toBeInTheDocument()
    cleanup()
    renderAt('/termos')
    expect(await screen.findByRole('heading', { name: 'Termos de utilização' })).toBeInTheDocument()
    cleanup()
    renderAt('/privacidade')
    expect(await screen.findByRole('heading', { name: 'Política de privacidade' })).toBeInTheDocument()
    cleanup()
    renderAt('/contacto')
    expect(await screen.findByRole('heading', { level: 1, name: 'Fale com a nossa equipa.' })).toBeInTheDocument()
  })
})
