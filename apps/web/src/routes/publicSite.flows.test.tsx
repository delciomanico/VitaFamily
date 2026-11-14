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
    expect(main.getByRole('link', { name: /portal da clínica/i })).toHaveAttribute('href', '/clinic/login')
    expect(main.getByRole('link', { name: /portal da seguradora/i })).toHaveAttribute('href', '/insurance/login')
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

  it('FAQ, termos, privacidade e contacto estão acessíveis sem sessão', async () => {
    renderAt('/faq')
    expect(await screen.findByRole('heading', { name: 'Perguntas frequentes' })).toBeInTheDocument()
    cleanup()
    renderAt('/termos')
    expect(await screen.findByRole('heading', { name: 'Termos de utilização' })).toBeInTheDocument()
    cleanup()
    renderAt('/privacidade')
    expect(await screen.findByRole('heading', { name: 'Política de privacidade' })).toBeInTheDocument()
    cleanup()
    renderAt('/contacto')
    expect(await screen.findByRole('heading', { name: 'Contacto' })).toBeInTheDocument()
  })
})
