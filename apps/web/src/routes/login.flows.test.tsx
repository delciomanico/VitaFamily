import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks/data/users'
import { resetDb } from '@/mocks/db'
import { DEMO_PROFESSIONAL_EMAIL, resetProfessionalDb } from '@/mocks/professionalDb'
import { routes } from './router'

function renderAt(path: string | { pathname: string; state?: unknown }) {
  const initial = path
  const router = createMemoryRouter(routes, { initialEntries: [initial] })
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
const familyTab = () => screen.findByRole('tab', { name: 'Família' })
const professionalTab = () => screen.findByRole('tab', { name: 'Médico ou especialista' })
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(cleanup)

describe('ecrã único de entrada', () => {
  it('abre no separador Família por omissão e com tabs acessíveis', async () => {
    renderAt('/entrar')
    expect(await familyTab()).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist', { name: 'Tipo de conta' })).toBeInTheDocument()
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', (await familyTab()).id)
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Esqueceu a palavra-passe?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('família entra pelo separador Família', async () => {
    const router = renderAt('/entrar')
    await familyTab()
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    expect(await screen.findByRole('heading', { name: /Olá, Monarca/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app')
  })

  it('?tipo=profissional abre o separador do profissional e entra no portal', async () => {
    const router = renderAt('/entrar?tipo=profissional')
    expect(await professionalTab()).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Registar-se como profissional' })).toHaveAttribute('href', '/profissional/registo')
    expect(screen.getByRole('link', { name: 'Esqueci-me da palavra-passe' })).toHaveAttribute('href', '/profissional/recuperar')
    type('E-mail', DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    expect(await screen.findByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Dra\. Helena$/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profissional')
  })

  it('especialista já com sessão: /entrar (sem tipo) leva ao portal, não ao login da família', async () => {
    const router = renderAt('/entrar?tipo=profissional')
    await professionalTab()
    type('E-mail', DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    await screen.findByRole('heading', { name: /Dra\. Helena$/ })
    await router.navigate('/entrar')
    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional'))
  })

  it('com ?tipo= explícito mantém o separador pedido, mesmo havendo sessão do outro tipo', async () => {
    const router = renderAt('/entrar?tipo=profissional')
    await professionalTab()
    type('E-mail', DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    await screen.findByRole('heading', { name: /Dra\. Helena$/ })
    await router.navigate('/entrar?tipo=familia')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect((await familyTab()).getAttribute('aria-selected')).toBe('true')
  })

  it('família já com sessão: /entrar (sem tipo) leva à Home da família, mesmo com o separador do especialista lembrado', async () => {
    const router = renderAt('/entrar')
    await familyTab()
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    await screen.findByRole('heading', { name: /Olá, Monarca/ })
    window.localStorage.setItem('vf.login.lastKind', 'profissional')
    await router.navigate('/entrar')
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
  })

  it('o separador inicial é o do último tipo de conta usado', async () => {
    window.localStorage.setItem('vf.login.lastKind', 'profissional')
    renderAt('/entrar')
    expect(await professionalTab()).toHaveAttribute('aria-selected', 'true')
  })

  it('?tipo desconhecido cai na Família e o separador reflete-se no URL', async () => {
    const router = renderAt('/entrar?tipo=xpto')
    expect(await familyTab()).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(await professionalTab())
    await waitFor(() => expect(router.state.location.search).toBe('?tipo=profissional'))
    fireEvent.click(await familyTab())
    await waitFor(() => expect(router.state.location.search).toBe('?tipo=familia'))
  })

  it('as contas não se misturam: credenciais de um lado não entram no outro', async () => {
    renderAt('/entrar')
    await familyTab()
    type('E-mail', DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    expect(await screen.findByText('E-mail ou palavra-passe incorretos.')).toBeInTheDocument()
  })

  it('o erro é idêntico nos dois separadores, exista ou não o e-mail do outro lado', async () => {
    renderAt('/entrar')
    await familyTab()
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', 'errada-errada')
    submit()
    const familyMessage = (await screen.findByRole('alert')).textContent

    fireEvent.click(await professionalTab())
    // O e-mail da família não existe do lado do profissional: a mensagem é a mesma.
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', 'errada-errada')
    submit()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toBe(familyMessage)
  })

  it('mudar de separador limpa o erro e a palavra-passe', async () => {
    renderAt('/entrar')
    await familyTab()
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', 'errada-errada')
    submit()
    await screen.findByRole('alert')

    fireEvent.click(await professionalTab())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveValue('')
    expect(screen.getByLabelText('Palavra-passe')).toHaveValue('')

    fireEvent.click(await familyTab())
    expect(screen.getByLabelText('Palavra-passe')).toHaveValue('')
  })

  it('teclado: setas, Home e End mudam de separador e movem o foco', async () => {
    renderAt('/entrar')
    const family = await familyTab()
    const professional = await professionalTab()
    expect(family).toHaveAttribute('tabindex', '0')
    expect(professional).toHaveAttribute('tabindex', '-1')
    family.focus()
    fireEvent.keyDown(family, { key: 'ArrowRight' })
    await waitFor(() => expect(professional).toHaveAttribute('aria-selected', 'true'))
    expect(professional).toHaveFocus()
    fireEvent.keyDown(professional, { key: 'ArrowRight' })
    await waitFor(() => expect(family).toHaveAttribute('aria-selected', 'true'))
    expect(family).toHaveFocus()
    fireEvent.keyDown(family, { key: 'ArrowLeft' })
    await waitFor(() => expect(professional).toHaveAttribute('aria-selected', 'true'))
    fireEvent.keyDown(professional, { key: 'Home' })
    await waitFor(() => expect(family).toHaveAttribute('aria-selected', 'true'))
    fireEvent.keyDown(family, { key: 'End' })
    await waitFor(() => expect(professional).toHaveAttribute('aria-selected', 'true'))
  })

  it('/login e /profissional/entrar redirecionam para o ecrã único', async () => {
    const family = renderAt('/login')
    expect(await familyTab()).toHaveAttribute('aria-selected', 'true')
    expect(family.state.location.pathname).toBe('/entrar')
    expect(family.state.location.search).toBe('?tipo=familia')
    cleanup()

    const professional = renderAt('/profissional/entrar')
    expect(await professionalTab()).toHaveAttribute('aria-selected', 'true')
    expect(professional.state.location.pathname).toBe('/entrar')
    expect(professional.state.location.search).toBe('?tipo=profissional')
  })

  it('o destino pós-login (next) sobrevive ao redirecionamento da rota antiga', async () => {
    const router = renderAt('/login?next=/app/health')
    await familyTab()
    expect(router.state.location.search).toBe('?tipo=familia&next=%2Fapp%2Fhealth')
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    expect(await screen.findByRole('heading', { name: 'Minha saúde' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app/health')
  })

  it('o destino guardado pelo guard (state.from) sobrevive ao redirecionamento antigo do profissional', async () => {
    const router = renderAt({ pathname: '/profissional/entrar', state: { from: '/profissional/perfil' } })
    await professionalTab()
    type('E-mail', DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    await waitFor(() => expect(router.state.location.pathname).toBe('/profissional/perfil'))
  })

  it('next externo ou para outro sítio é ignorado', async () => {
    const router = renderAt('/entrar?tipo=familia&next=//evil.example')
    await familyTab()
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    submit()
    expect(await screen.findByRole('heading', { name: /Olá, Monarca/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app')
  })

  it('sem sessão, uma página do portal do profissional leva ao separador do profissional', async () => {
    const router = renderAt('/profissional/perfil')
    expect(await professionalTab()).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.pathname).toBe('/entrar')
    expect(router.state.location.search).toBe('?tipo=profissional')
  })
})
