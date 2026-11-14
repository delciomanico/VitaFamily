import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import { confirmLinkRequest } from '@/mocks/handlers/insurerOps'
import { CLAIM_LIMIT } from '@/mocks/handlers/insuranceCards'
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

const PAGE = '/app/family/mem_monarca/insurance'
const asFamily = (userId = 'usr_monarca') => window.sessionStorage.setItem('vf.session.userId', userId)

/** Cartão do João já confirmado pela seguradora e ligado ao membro. */
function linkedCard() {
  db.insurerOps.linkRequests.push({
    id: 'lnk_joao',
    insurerId: 'ins_aurora',
    familyId: 'fam_monarca',
    memberId: 'mem_monarca',
    beneficiaryId: 'ben_joao',
    beneficiaryName: 'João Mendes',
    cardNumber: 'AUR-000001',
    status: 'CONFIRMED',
    requestedAt: '2026-11-01T10:00:00.000Z',
    decidedAt: '2026-11-02T10:00:00.000Z',
    decisionNote: null,
  })
}

async function openClaim() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reclamar cartão' }))
  return within(await screen.findByRole('dialog'))
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
  asFamily()
})
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('cartão da seguradora no app do paciente', () => {
  it('estado vazio com a ação de reclamar', async () => {
    renderAt(PAGE)
    expect(await screen.findByText('Ainda não ligou o cartão da seguradora.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reclamar cartão' })).toBeInTheDocument()
  })

  it('reclamar: erro único e genérico para apólice ou código errados; depois fica a aguardar confirmação', async () => {
    renderAt(PAGE)
    const dialog = await openClaim()
    fireEvent.change(dialog.getByLabelText('Seguradora'), { target: { value: 'ins_aurora' } })
    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-2026-0001' } })
    fireEvent.input(dialog.getByLabelText('Código da seguradora'), { target: { value: 'ERRADO00' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    const generic = 'Não foi possível validar o cartão. Confirme o número da apólice e o código e tente novamente.'
    expect(await dialog.findByText(generic)).toBeInTheDocument()

    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-INEXISTENTE' } })
    fireEvent.input(dialog.getByLabelText('Código da seguradora'), { target: { value: 'JOAO-2345' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    expect(await dialog.findByText(generic)).toBeInTheDocument() // a mesma mensagem

    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-2026-0001' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Pedido enviado. A seguradora vai confirmar a ligação.')).toBeInTheDocument()
    const requests = (await screen.findByRole('heading', { name: 'Pedidos de ligação' })).closest('div')!
    expect(within(requests).getByText('A aguardar confirmação')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Cartão / })).not.toBeInTheDocument()
  })

  it('reclamar com pedido já em curso: 409 com mensagem própria', async () => {
    db.insurerOps.linkRequests.push({
      id: 'lnk_x', insurerId: 'ins_aurora', familyId: 'fam_monarca', memberId: 'mem_monarca', beneficiaryId: 'ben_ana',
      beneficiaryName: 'Ana Mendes', cardNumber: 'AUR-000002', status: 'PENDING', requestedAt: '2026-11-10T10:00:00.000Z',
    })
    renderAt(PAGE)
    const dialog = await openClaim()
    fireEvent.change(dialog.getByLabelText('Seguradora'), { target: { value: 'ins_aurora' } })
    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-2026-0001' } })
    fireEvent.input(dialog.getByLabelText('Código da seguradora'), { target: { value: 'JOAO-2345' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    expect(await dialog.findByText(/Já existe um pedido em curso ou um cartão ligado/)).toBeInTheDocument()
  })

  it('reclamar com rate limit: mostra a espera do Retry-After e bloqueia o botão', async () => {
    db.insurerOps.claimAttempts.usr_monarca = Array.from({ length: CLAIM_LIMIT }, () => Date.now())
    renderAt(PAGE)
    const dialog = await openClaim()
    fireEvent.change(dialog.getByLabelText('Seguradora'), { target: { value: 'ins_aurora' } })
    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-2026-0001' } })
    fireEvent.input(dialog.getByLabelText('Código da seguradora'), { target: { value: 'JOAO-2345' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    expect(await dialog.findByText(/Tente de novo dentro de \d+ minutos/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: /Aguarde \d+ s/ })).toBeDisabled()
  })

  it('pedido rejeitado mostra o motivo da seguradora', async () => {
    db.insurerOps.linkRequests.push({
      id: 'lnk_r', insurerId: 'ins_aurora', familyId: 'fam_monarca', memberId: 'mem_monarca', beneficiaryId: 'ben_ana',
      beneficiaryName: 'Ana Mendes', cardNumber: 'AUR-000002', status: 'REJECTED', requestedAt: '2026-11-10T10:00:00.000Z',
      decidedAt: '2026-11-11T10:00:00.000Z', decisionNote: 'Dados não coincidem',
    })
    renderAt(PAGE)
    expect(await screen.findByText('Rejeitado')).toBeInTheDocument()
    expect(screen.getByText(/A seguradora rejeitou o pedido: Dados não coincidem/)).toBeInTheDocument()
  })

  it('cartão digital: nome, número, plano, validade e estado; só depois da confirmação da seguradora', async () => {
    renderAt(PAGE)
    const dialog = await openClaim()
    fireEvent.change(dialog.getByLabelText('Seguradora'), { target: { value: 'ins_aurora' } })
    fireEvent.input(dialog.getByLabelText('Número da apólice'), { target: { value: 'AP-2026-0001' } })
    fireEvent.input(dialog.getByLabelText('Código da seguradora'), { target: { value: 'JOAO-2345' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('A aguardar confirmação')
    cleanup()

    const pending = db.insurerOps.linkRequests.find((l) => l.memberId === 'mem_monarca')!
    await confirmLinkRequest('iac_aurora_manager', pending.id)
    renderAt(PAGE)
    const card = await screen.findByRole('group', { name: 'Cartão Seguradora Aurora' })
    expect(within(card).getByText('AUR-000001')).toBeInTheDocument()
    expect(within(card).getByText('João Mendes')).toBeInTheDocument()
    expect(within(card).getByText('Plano Básico')).toBeInTheDocument()
    expect(within(card).getByText(/31 de dezembro de 2027|31 dez/i)).toBeInTheDocument()
    expect(within(card).getByText('Ativo')).toBeInTheDocument()
  })

  it('várias seguradoras: um cartão por seguradora', async () => {
    linkedCard()
    db.insurers.push({ id: 'ins_norte', name: 'Seguradora Norte', taxId: '500300400', status: 'ACTIVE' })
    db.insurerOps.modules.ins_norte = { enabled: true, currency: 'AOA' }
    db.insurerOps.beneficiaries.push({
      id: 'ben_norte', insurerId: 'ins_norte', companyId: null, holderId: null, name: 'Monarca Lopes', idDocumentType: 'BI',
      idDocumentNumber: '1', birthDate: '1985-03-12', relationship: 'HOLDER', cardNumber: 'NOR-000001', status: 'SUSPENDED',
      linked: true, statusNote: null, createdAt: '2026-01-10T09:00:00.000Z',
    })
    db.insurerOps.linkRequests.push({
      id: 'lnk_norte', insurerId: 'ins_norte', familyId: 'fam_monarca', memberId: 'mem_monarca', beneficiaryId: 'ben_norte',
      beneficiaryName: 'Monarca Lopes', cardNumber: 'NOR-000001', status: 'CONFIRMED', requestedAt: '2026-11-01T10:00:00.000Z',
    })
    renderAt(PAGE)
    expect(await screen.findByRole('group', { name: 'Cartão Seguradora Aurora' })).toBeInTheDocument()
    const norte = await screen.findByRole('group', { name: 'Cartão Seguradora Norte' })
    expect(within(norte).getByText('Suspenso')).toBeInTheDocument()
    expect(within(norte).getByText('Sem apólice ativa')).toBeInTheDocument()
  })

  it('cobertura e limites anuais em Kz, sem saldo', async () => {
    linkedCard()
    renderAt(PAGE)
    const card = await screen.findByRole('group', { name: 'Cartão Seguradora Aurora' })
    const toggle = within(card).getByRole('button', { name: /Cobertura e limites/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await within(card).findByText('Hemograma completo')).toBeInTheDocument()
    expect(within(card).getByText(/limite anual 50\s?000,00 Kz/)).toBeInTheDocument()
    expect(within(card).getByText(/Paga 80 %/)).toBeInTheDocument()
    expect(within(card).getByText(/sem limite anual/)).toBeInTheDocument()
    expect(within(card).getByText(/O valor já usado ainda não é mostrado/)).toBeInTheDocument()
    expect(within(card).getAllByText('Exige autorização')).toHaveLength(1)
  })

  it('QR com contagem decrescente de 120 s, expira e renova', async () => {
    linkedCard()
    renderAt(PAGE)
    const card = await screen.findByRole('group', { name: 'Cartão Seguradora Aurora' })
    // Só o relógio é adiantado (sem fake timers: o waitFor do Testing Library usa setInterval); o intervalo de 1 s é real.
    const realNow = Date.now.bind(Date)
    let skewMs = 0
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skewMs)

    fireEvent.click(within(card).getByRole('button', { name: /Mostrar QR/ }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByRole('img', { name: 'QR do cartão AUR-000001' })).toBeInTheDocument()
    expect(dialog.getByRole('timer')).toHaveTextContent(/Expira em (2:00|1:59)/)

    skewMs = 30_000
    expect(await dialog.findByText(/^(1:29|1:30)$/)).toBeInTheDocument()

    skewMs = 121_000
    expect(await dialog.findByText('O QR expirou. Renove para gerar um novo.')).toBeInTheDocument()
    expect(dialog.queryByRole('timer')).not.toBeInTheDocument()

    skewMs = 0
    fireEvent.click(dialog.getByRole('button', { name: 'Renovar QR' }))
    // Foi emitido um QR novo (2.º pedido) e a contagem volta a correr.
    await waitFor(() => expect(db.insurerOps.qrIssues.ben_joao).toHaveLength(2))
    expect(await dialog.findByRole('timer')).toHaveTextContent(/Expira em [12]:\d\d/)
  })

  it('desligar pede confirmação e remove o cartão', async () => {
    linkedCard()
    renderAt(PAGE)
    const card = await screen.findByRole('group', { name: 'Cartão Seguradora Aurora' })
    fireEvent.click(within(card).getByRole('button', { name: /^Desligar/ }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Desligar cartão?')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Voltar' }))
    expect(db.insurerOps.linkRequests.find((l) => l.id === 'lnk_joao')!.status).toBe('CONFIRMED')

    fireEvent.click(within(card).getByRole('button', { name: /^Desligar/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Desligar' }))
    expect(await screen.findByText('Cartão Seguradora Aurora desligado.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Cartão Seguradora Aurora' })).not.toBeInTheDocument())
    expect(db.insurerOps.linkRequests.find((l) => l.id === 'lnk_joao')!.status).toBe('REVOKED')
  })

  it('quem não é o próprio nem o tutor não vê o cartão', async () => {
    window.sessionStorage.clear()
    asFamily('usr_ana')
    renderAt(PAGE)
    expect(await screen.findByText('Só o próprio ou o tutor podem ver o seguro deste membro.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reclamar cartão' })).not.toBeInTheDocument()
  })
})
