import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_CLINIC_ADMIN_EMAIL } from '@/mocks/data/clinicAccounts'
import { DEMO_INVITATION_CODE } from '@/mocks/data/families'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_VERIFICATION_CODE } from '@/mocks/data/users'
import { db, resetDb } from '@/mocks/db'
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

/** Dia seguinte (yyyy-mm-dd local), para publicar horários futuros. */
function tomorrowISO(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function type(label: string | RegExp, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})

describe('fluxos de autenticação', () => {
  it('sem sessão, /app redireciona para o login', async () => {
    const router = renderAt('/app/health')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('login demo leva à página pedida', async () => {
    const router = renderAt('/app/health')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: 'Minha saúde' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app/health')
  })

  it('login demo a partir do login abre a Home com o resumo', async () => {
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: /Olá, Monarca/ })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Próximo compromisso/ })).toHaveAttribute('href', '/app/appointments/apt_cardio')
    expect(screen.getByRole('link', { name: 'Relatórios, 1 pendente' })).toHaveAttribute('href', '/app/reports/family')
    expect(screen.getByRole('link', { name: 'Marcar consulta' })).toHaveAttribute('href', '/app/appointments/new')
  })

  it('credenciais erradas mostram mensagem amigável', async () => {
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', 'errada')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('E-mail ou palavra-passe incorretos.')).toBeInTheDocument()
  })

  it('registo → verificação → configuração da família', async () => {
    const router = renderAt('/register')
    await screen.findByRole('heading', { name: 'Criar conta' })
    type('Nome', 'Ana Teste')
    type('E-mail', 'ana@exemplo.test')
    type('Data de nascimento', '1990-01-01')
    type(/^Palavra-passe/, 'uma-frase-longa')
    type('Confirmar palavra-passe', 'uma-frase-longa')
    fireEvent.click(screen.getByLabelText(/Li e aceito/))
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('heading', { name: 'Digite o código enviado' })).toBeInTheDocument()
    fireEvent.input(screen.getByLabelText('Dígito 1 de 6'), { target: { value: DEMO_VERIFICATION_CODE } })

    expect(await screen.findByRole('heading', { name: 'Bem-vindo ao Vita Family' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup/family')
  })

  it('perfil de saúde: ver, editar e guardar', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/health/profile')
    expect(await screen.findByText('Asma')).toBeInTheDocument()
    expect(screen.getByText('O+')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Editar perfil' }))
    fireEvent.change(await screen.findByLabelText('Tipo sanguíneo'), { target: { value: 'AB-' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remover Asma' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Perfil atualizado.')).toBeInTheDocument()
    // Espera pela vista (o formulário também contém a opção “AB-”).
    await screen.findByRole('button', { name: 'Editar perfil' })
    expect(screen.getByText('AB-')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma condição registada.')).toBeInTheDocument()
  })

  it('histórico médico filtra por tipo', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/health/history')
    expect(await screen.findByText('Apendicectomia')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Exames' }))
    expect(screen.queryByText('Apendicectomia')).not.toBeInTheDocument()
    expect(screen.getAllByText('Análises clínicas').length).toBeGreaterThan(0)
  })

  it('convite inválido mostra mensagem clara (sem sessão)', async () => {
    renderAt('/invite/accept?token=NAO-EXISTE')
    expect(await screen.findByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument()
    expect(screen.getByText('Este convite é inválido, já foi usado ou foi revogado.')).toBeInTheDocument()
  })

  it('convite válido sem sessão oferece entrar ou criar conta', async () => {
    const router = renderAt(`/invite/accept?token=${DEMO_INVITATION_CODE}`)
    // O título já aparece durante o carregamento: esperar pelos dados do convite.
    expect(await screen.findByText('Família Monarca')).toBeInTheDocument()
    expect(screen.getByText(DEMO_EMAIL)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Já tenho conta: entrar' }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('autenticado com o e-mail convidado aceita o convite e entra na família', async () => {
    // Novo utilizador sem família, com um convite MEMBER dedicado (evita o conflito de aceitar
    // um convite para a própria família de que o utilizador demo já é Admin).
    const token = 'CONVITE-ANA'
    db.invitations.push({
      code: token,
      familyId: 'fam_monarca',
      status: 'PENDING',
      invitedEmail: 'ana@exemplo.test',
      type: 'MEMBER',
    })

    const router = renderAt('/register')
    await screen.findByRole('heading', { name: 'Criar conta' })
    type('Nome', 'Ana Teste')
    type('E-mail', 'ana@exemplo.test')
    type('Data de nascimento', '1990-01-01')
    type(/^Palavra-passe/, 'uma-frase-longa')
    type('Confirmar palavra-passe', 'uma-frase-longa')
    fireEvent.click(screen.getByLabelText(/Li e aceito/))
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByRole('heading', { name: 'Digite o código enviado' })).toBeInTheDocument()
    fireEvent.input(screen.getByLabelText('Dígito 1 de 6'), { target: { value: DEMO_VERIFICATION_CODE } })
    await screen.findByRole('heading', { name: 'Bem-vindo ao Vita Family' })

    router.navigate(`/invite/accept?token=${token}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar convite' }))

    expect(await screen.findByRole('heading', { name: /Olá, Ana/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app')
  })

  it('autenticado com outro e-mail mostra incompatibilidade e permite sair', async () => {
    const token = 'CONVITE-OUTRO-EMAIL'
    db.invitations.push({
      code: token,
      familyId: 'fam_monarca',
      status: 'PENDING',
      invitedEmail: 'outra@exemplo.test',
      type: 'MEMBER',
    })
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')

    renderAt(`/invite/accept?token=${token}`)
    expect(await screen.findByRole('button', { name: 'Sair da sessão atual' })).toBeInTheDocument()
    expect(screen.getAllByText(/outra@exemplo\.test/).length).toBeGreaterThan(0)
  })

  it('o portal da clínica tem login próprio e não aceita a sessão de utilizador', async () => {
    // Sessão de `User` iniciada: não dá acesso ao portal (ADR-020) — exige a sessão de clínica.
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    const router = renderAt('/clinic/staff')
    expect(await screen.findByRole('heading', { name: 'Entrar na área da clínica' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clinic/login')

    type('E-mail da conta da clínica', DEMO_CLINIC_ADMIN_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    // Volta à página pedida, já dentro do portal.
    expect(await screen.findByRole('heading', { name: 'Contas da clínica' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clinic/staff')
  })

  it('só o Admin da clínica chega às contas da clínica (BR-CLN-05)', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    const router = renderAt('/clinic/staff')
    // Gestor: sem separador “Contas” e redirecionado para os pedidos.
    expect(await screen.findByRole('heading', { name: 'Pedidos de consulta' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clinic')
    expect(screen.queryByRole('link', { name: 'Contas' })).not.toBeInTheDocument()
  })

  it('o Admin da clínica cria uma conta de Gestor', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/staff')
    expect(await screen.findByRole('heading', { name: 'Contas da clínica' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Novo Gestor' }))
    type('E-mail', 'nova@clinicahorizonte.pt')
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('nova@clinicahorizonte.pt')).toBeInTheDocument()
  })

  it('a clínica publica horários e a família vê-os ao marcar (D17)', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/slots')
    await screen.findByRole('heading', { name: 'Horários' })

    fireEvent.click(screen.getByRole('button', { name: 'Publicar horários' }))
    fireEvent.change(await screen.findByLabelText('Dia'), { target: { value: tomorrowISO() } })
    type('Especialidade', 'Ortopedia')
    fireEvent.click(screen.getByRole('button', { name: '09:00' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))

    expect(await screen.findByText('1 horário publicado.')).toBeInTheDocument()
    expect(db.slots.some((s) => s.specialty === 'Ortopedia' && s.clinicId === 'cln_horizonte')).toBe(true)
  })

  it('a clínica completa a consulta com receita e o paciente passa a vê-la (BR-CLN-06/BR-RX-07)', async () => {
    // Consulta confirmada e já em curso (hora passada) numa clínica parceira.
    db.appointments.push({
      id: 'apt_curso',
      familyId: 'fam_monarca',
      memberId: 'mem_maria',
      scheduledAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'SCHEDULED',
      slotId: 'slot_curso',
      specialty: 'Dermatologia',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    })
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/agenda')
    await screen.findByRole('heading', { name: 'Agenda da clínica' })

    fireEvent.click(await screen.findByRole('button', { name: 'Completar consulta' }))
    fireEvent.input(await screen.findByLabelText('Resultado da consulta'), {
      target: { value: 'Dermatite de contacto.' },
    })
    fireEvent.click(screen.getByLabelText('Emitir receita'))
    type('Nome', 'Hidrocortisona')
    type('Dosagem', '1%')
    fireEvent.click(screen.getByRole('button', { name: 'Concluir consulta' }))

    expect(await screen.findByText('Consulta concluída.')).toBeInTheDocument()
    const issued = db.prescriptions.find((p) => p.appointmentId === 'apt_curso')
    expect(issued).toMatchObject({ issuedBy: 'CLINIC', memberId: 'mem_maria' })

    // Do lado da família: a receita aparece na lista, marcada como emitida pela clínica.
    cleanup()
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/health/prescriptions')
    expect(await screen.findByText(/Emitida pela clínica/)).toBeInTheDocument()
  })

  it('registo valida idade mínima e confirmação da palavra-passe', async () => {
    renderAt('/register')
    await screen.findByRole('heading', { name: 'Criar conta' })
    type('Data de nascimento', '2015-01-01')
    type(/^Palavra-passe/, 'uma-frase-longa')
    type('Confirmar palavra-passe', 'outra-frase-longa')
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText(/18 anos ou mais/)).toBeInTheDocument()
    expect(screen.getByText('As palavras-passe não coincidem.')).toBeInTheDocument()
    expect(screen.getByText('É necessário aceitar os termos para continuar.')).toBeInTheDocument()
  })
})
