import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    // Gestor: sem separador “Contas” e redirecionado para a página “Hoje”.
    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clinic')
    expect(screen.queryByRole('link', { name: 'Contas' })).not.toBeInTheDocument()
  })

  it('o Admin da clínica cria uma conta de Gestor', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/staff')
    expect(await screen.findByRole('heading', { name: 'Contas da clínica' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Nova conta' }))
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
      // Hora passada mas sempre no dia de hoje (senão, logo após a meia-noite, cairia em “ontem”).
      scheduledAt: new Date(Math.max(Date.now() - 60 * 60_000, new Date().setHours(0, 0, 1, 0))).toISOString(),
      status: 'SCHEDULED',
      slotId: 'slot_curso',
      specialty: 'Dermatologia',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    })
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/agenda')
    await screen.findByRole('heading', { name: 'Agenda da clínica' })
    // O calendário por profissional é a vista inicial; a lista com ações é a vista alternativa.
    fireEvent.click(await screen.findByRole('tab', { name: 'Lista' }))

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

  it('a clínica pesquisa um paciente, abre a ficha e vê o histórico partilhado (BR-CLN-21)', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/patients')
    await screen.findByRole('heading', { name: 'Pacientes' })
    fireEvent.change(await screen.findByLabelText('Pesquisar paciente'), { target: { value: 'helena' } })
    expect(await screen.findByText('Helena Baptista')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Monarca Lopes')).not.toBeInTheDocument())

    cleanup()
    renderAt('/clinic/patients/cpt_monarca')
    expect(await screen.findByRole('heading', { name: 'Monarca Lopes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico partilhado' }))
    expect(await screen.findByText(/Partilhado pelo paciente, só para leitura/)).toBeInTheDocument()

    // Sem partilha: aviso claro, sem dados.
    cleanup()
    renderAt('/clinic/patients/cpt_helena')
    await screen.findByRole('heading', { name: 'Helena Baptista' })
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico partilhado' }))
    expect(await screen.findByText('Este paciente não partilha o histórico.')).toBeInTheDocument()
  })

  it('a família gera o código para a clínica e vê as clínicas com acesso', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/family/mem_monarca')
    expect(await screen.findByRole('heading', { name: 'Clínicas e partilha' })).toBeInTheDocument()
    expect(await screen.findByText('Clínica Horizonte')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Gerar código para a clínica' })[0]!)
    expect(await screen.findByRole('timer')).toHaveTextContent(/10:00|09:5\d/)
  })

  it('Hoje: a fila do dia (Chegou → Iniciar → Concluir com "Voltar em…") e os indicadores (M14 Q)', async () => {
    // Consulta de hoje, já iniciada a hora mas sempre no dia de hoje (senão, logo após a meia-noite, cairia em "ontem").
    db.appointments.push({
      id: 'apt_fila',
      familyId: 'fam_monarca',
      memberId: 'mem_maria',
      scheduledAt: new Date(Math.max(Date.now() - 30 * 60_000, new Date().setHours(0, 0, 1, 0))).toISOString(),
      status: 'SCHEDULED',
      slotId: 'slot_fila',
      specialty: 'Dermatologia',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    })
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    renderAt('/clinic')
    await screen.findByRole('heading', { name: 'Hoje' })

    fireEvent.click(await screen.findByRole('button', { name: 'Chegou' }))
    expect(await screen.findByText('Chegada registada.')).toBeInTheDocument()
    expect(db.appointments.find((a) => a.id === 'apt_fila')).toMatchObject({ status: 'SCHEDULED' })
    expect(db.appointments.find((a) => a.id === 'apt_fila')?.arrivedAt).toBeDefined()
    // Estado derivado "Chegou" com a espera em minutos; já só se oferece Iniciar / Concluir.
    expect(await screen.findByText(/^Chegou · \d+ min$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chegou' })).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }))
    expect(await screen.findByText('Consulta iniciada.')).toBeInTheDocument()
    expect(await screen.findByText('Em consulta')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    fireEvent.input(await screen.findByLabelText('Resultado da consulta'), { target: { value: 'Tudo bem.' } })
    fireEvent.change(screen.getByLabelText('Voltar em… (opcional)'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Concluir consulta' }))
    expect(await screen.findByText('Consulta concluída.')).toBeInTheDocument()
    const done = db.appointments.find((a) => a.id === 'apt_fila')!
    expect(done.status).toBe('COMPLETED')
    expect(done.followUpDueOn).toBeDefined()
    expect(await screen.findByText('Concluída')).toBeInTheDocument()

    // Relatórios: só contagens, sem nomes de pacientes.
    cleanup()
    renderAt('/clinic/reports')
    expect(await screen.findByRole('heading', { name: 'Relatórios' })).toBeInTheDocument()
    expect(await screen.findByText('Consultas realizadas')).toBeInTheDocument()
    expect(screen.getByText('Taxa de faltas: 0 %')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '7 dias' }))
    expect(await screen.findByText('Novos pacientes')).toBeInTheDocument()
    expect(screen.queryByText('Maria', { exact: false })).not.toBeInTheDocument()
  })

  it('a família responde ao pedido de confirmação: "Vou" no alerta e "Não posso" na consulta (M14 Q)', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/alerts')
    await screen.findByRole('heading', { name: 'Alertas' })
    // A consulta de amanhã (clínica parceira, sem resposta) tem o pedido de confirmação a 48 h.
    expect(await screen.findByText(/Confirma a consulta de Cardiologia\?/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Vou' })[0]!)
    expect(await screen.findByText('Presença confirmada.')).toBeInTheDocument()
    expect(db.appointments.find((a) => a.id === 'apt_cardio')).toMatchObject({
      confirmationStatus: 'CONFIRMED',
      confirmationSource: 'PATIENT',
    })

    // Na consulta: estado confirmado visível; "Não posso" cancela e oferece outro horário.
    cleanup()
    renderAt('/app/appointments/apt_cardio')
    expect(await screen.findByText('Presença confirmada.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Não posso' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText('Quer escolher outro horário?')).toBeInTheDocument()
    expect(db.appointments.find((a) => a.id === 'apt_cardio')).toMatchObject({
      status: 'CANCELLED',
      confirmationStatus: 'DECLINED',
    })
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

describe('M14 R: recibos, perfil, Médico e auditoria', () => {
  const completedToday = () => {
    db.slots.push({
      id: 'slot_r_flow',
      clinicId: 'cln_horizonte',
      kind: 'APPOINTMENT',
      capacity: 1,
      specialty: 'Consulta de cardiologia',
      professionalId: 'pro_ana',
      professionalName: 'Dr.ª Ana Costa',
      serviceTypeId: 'svc_cardio',
      startsAt: new Date().toISOString(),
      durationMinutes: 30,
    })
    db.appointments.push({
      id: 'apt_r_flow',
      familyId: 'fam_monarca',
      memberId: 'mem_maria',
      scheduledAt: new Date(Math.max(Date.now() - 30 * 60_000, new Date().setHours(0, 0, 1, 0))).toISOString(),
      status: 'COMPLETED',
      slotId: 'slot_r_flow',
      specialty: 'Consulta de cardiologia',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    })
  }

  it('emitir recibo com um toque, ver o documento não fiscal e o total no Financeiro', async () => {
    completedToday()
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir recibo' }))
    const emit = await screen.findByRole('button', { name: 'Emitir' })
    await waitFor(() => expect(emit).toBeEnabled())
    fireEvent.click(emit)
    expect(await screen.findByLabelText('Recibo R-000001', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getAllByText('Documento não fiscal').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Imprimir/ })).toBeInTheDocument()
    expect(db.clinicReceipts).toHaveLength(1)

    cleanup()
    renderAt('/clinic/finance')
    expect(await screen.findByText('R-000001', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Total emitido')).toBeInTheDocument()
  })

  it('anular com motivo tira o recibo do total', async () => {
    completedToday()
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    const { issueClinicReceipt } = await import('@/mocks/handlers/clinicReceipts')
    const receipt = await issueClinicReceipt('cac_horizonte_rececao', {
      bookingKind: 'APPOINTMENT',
      bookingId: 'apt_r_flow',
      paymentMethod: 'CASH',
    })
    renderAt(`/clinic/finance/${receipt.id}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }))
    fireEvent.input(await screen.findByLabelText('Motivo da anulação'), { target: { value: 'Valor errado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anular recibo' }))
    expect(await screen.findByText('Recibo anulado.')).toBeInTheDocument()
    expect(db.clinicReceipts[0]).toMatchObject({ status: 'VOIDED', voidReason: 'Valor errado' })
  })

  it('o Médico só vê Hoje, Agenda, Pacientes e Exames; Financeiro e Definições redirecionam', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_medica')
    const router = renderAt('/clinic/finance')
    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clinic')
    for (const name of ['Financeiro', 'Relatórios', 'Definições', 'Contas', 'Pedidos', 'Horários', 'Serviços']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('link', { name: 'Pacientes' }).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Pesquisa global')).not.toBeInTheDocument()
    router.navigate('/clinic/settings')
    await waitFor(() => expect(router.state.location.pathname).toBe('/clinic'))
  })

  it('perfil: o Admin edita e o Gestor só lê', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    renderAt('/clinic/settings')
    const field = await screen.findByLabelText('Telefone')
    fireEvent.input(field, { target: { value: '+244 900 111 222' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Perfil atualizado.')).toBeInTheDocument()
    expect(db.clinics.find((c) => c.id === 'cln_horizonte')?.phone).toBe('+244 900 111 222')

    cleanup()
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    renderAt('/clinic/settings')
    expect(await screen.findByLabelText('Telefone')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('auditoria: só o Admin, com ações traduzidas', async () => {
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_rececao')
    const router = renderAt('/clinic/settings/audit')
    await screen.findByRole('heading', { name: 'Hoje' })
    expect(router.state.location.pathname).toBe('/clinic')

    cleanup()
    window.sessionStorage.setItem('vf.clinic.session.accountId', 'cac_horizonte_admin')
    const { updateClinicProfile } = await import('@/mocks/handlers/clinicReceipts')
    await updateClinicProfile('cac_horizonte_admin', { phone: '1 2 3 4 5' })
    renderAt('/clinic/settings/audit')
    expect(await screen.findByText('Atualizou o perfil da clínica')).toBeInTheDocument()
  })

  it('família: recibo recebido aparece em Seguro e reembolsos como comprovativo imprimível', async () => {
    db.clinicConsents.push({ memberId: 'mem_maria', clinicId: 'cln_horizonte', level: 'BOOKINGS' })
    completedToday()
    const { issueClinicReceipt } = await import('@/mocks/handlers/clinicReceipts')
    await issueClinicReceipt('cac_horizonte_rececao', { bookingKind: 'APPOINTMENT', bookingId: 'apt_r_flow', paymentMethod: 'CARD' })
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/family/mem_maria/insurance')
    fireEvent.click(await screen.findByRole('link', { name: /R-000001/ }))
    expect(await screen.findByLabelText('Recibo R-000001', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Imprimir/ })).toBeInTheDocument()
  })
})
