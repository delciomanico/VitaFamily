import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import { ELIGIBILITY_LIMIT } from '@/mocks/handlers/clinicInsurers'
import { routes } from './router'

const ADMIN = 'iac_aurora_admin'
const MANAGER = 'iac_aurora_manager'
const AGENT = 'iac_aurora_agent'

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

const asInsurer = (id: string) => window.sessionStorage.setItem('vf.insurance.session.accountId', id)
const asClinic = (id: string) => window.sessionStorage.setItem('vf.clinic.session.accountId', id)
const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })
// A barra lateral (desktop) e os separadores (telemóvel) coexistem no DOM; em jsdom ambos contam. Escolhe-se os separadores.
const nav = () => {
  const navs = screen.getAllByRole('navigation', { name: 'Portal da seguradora' })
  return within(navs[navs.length - 1]!)
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})
afterEach(cleanup)

describe('portal da seguradora: navegação por papel (§8.2b)', () => {
  it('Gestor de beneficiários: vai para beneficiários e não vê pedidos, clínicas nem contas', async () => {
    asInsurer(MANAGER)
    const router = renderAt('/insurance')
    expect(await screen.findByRole('heading', { name: 'Beneficiários' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/insurance/beneficiaries')
    for (const name of ['Beneficiários', 'Apólices', 'Ligações', 'Importação', 'Empresas', 'Planos', 'Serviços']) {
      expect(nav().getByRole('link', { name })).toBeInTheDocument()
    }
    for (const name of ['Pedidos', 'Clínicas', 'Contas']) expect(nav().queryByRole('link', { name })).not.toBeInTheDocument()
  })

  it('Gestor não acede às clínicas por URL', async () => {
    asInsurer(MANAGER)
    const router = renderAt('/insurance/providers')
    await waitFor(() => expect(router.state.location.pathname).toBe('/insurance/beneficiaries'))
  })

  it('Agente só tem pedidos de reembolso e é redirecionado do módulo operacional', async () => {
    asInsurer(AGENT)
    const router = renderAt('/insurance/beneficiaries')
    await waitFor(() => expect(router.state.location.pathname).toBe('/insurance'))
    expect(nav().getAllByRole('link')).toHaveLength(1)
    expect(nav().getByRole('link', { name: 'Pedidos' })).toBeInTheDocument()
  })

  it('Admin vê tudo, incluindo Clínicas e Contas', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance')
    await screen.findAllByRole('navigation', { name: 'Portal da seguradora' })
    expect(await nav().findByRole('link', { name: 'Pedidos' })).toBeInTheDocument()
    for (const name of ['Beneficiários', 'Clínicas', 'Contas']) expect(nav().getByRole('link', { name })).toBeInTheDocument()
  })

  it('faixa com o nome da seguradora (/me) e módulo desativado esconde os separadores operacionais', async () => {
    db.insurerOps.modules.ins_aurora!.enabled = false
    asInsurer(ADMIN)
    renderAt('/insurance')
    expect((await screen.findAllByText('Seguradora Aurora')).length).toBeGreaterThan(0)
    await waitFor(() => expect(nav().queryByRole('link', { name: 'Beneficiários' })).not.toBeInTheDocument())
    expect(nav().queryByRole('link', { name: 'Clínicas' })).not.toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Pedidos' })).toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Contas' })).toBeInTheDocument()
  })

  it('moeda do /me nos planos (USD em vez de Kz)', async () => {
    db.insurerOps.modules.ins_aurora!.currency = 'USD'
    asInsurer(ADMIN)
    renderAt('/insurance/plans/pln_basico')
    expect(await screen.findByRole('heading', { name: /Plano Básico · versão 1/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('table')).toHaveTextContent(/US\$|USD/))
    expect(screen.getByRole('table')).not.toHaveTextContent('Kz')
  })

  it('módulo desativado: estado vazio claro', async () => {
    db.insurerOps.modules.ins_aurora!.enabled = false
    asInsurer(ADMIN)
    renderAt('/insurance/beneficiaries')
    expect(await screen.findByText('Módulo operacional não ativo.')).toBeInTheDocument()
  })
})

describe('titular por pesquisa no servidor', () => {
  it('só titulares, filtrados por q; o escolhido mantém-se', async () => {
    asInsurer(MANAGER)
    renderAt('/insurance/policies')
    fireEvent.click(await screen.findByRole('button', { name: /Nova apólice/ }))
    const dialog = within(await screen.findByRole('dialog'))
    const select = dialog.getByLabelText('Titular') as HTMLSelectElement
    await waitFor(() => expect(within(select).getByText(/João Mendes/)).toBeInTheDocument())
    expect(within(select).queryByText(/Ana Mendes/)).not.toBeInTheDocument() // cônjuge: não é titular
    fireEvent.input(dialog.getByLabelText('Procurar titular'), { target: { value: 'pedro' } })
    await waitFor(() => expect(within(select).queryByText(/João Mendes/)).not.toBeInTheDocument())
    expect(within(select).getByText(/Pedro Quimbo/)).toBeInTheDocument()
  })
})

describe('beneficiários', () => {
  it('lista, pesquisa e cria um beneficiário pendente', async () => {
    asInsurer(MANAGER)
    renderAt('/insurance/beneficiaries')
    expect((await screen.findAllByText('João Mendes')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pedro Quimbo').length).toBeGreaterThan(0)

    type(/Nome, nº de cartão/, 'pedro')
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }))
    await waitFor(() => expect(screen.queryByText('João Mendes')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Novo beneficiário' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar beneficiário' }))
    expect(await within(dialog).findByText('Indique o nome.')).toBeInTheDocument()
    fireEvent.input(within(dialog).getByLabelText('Nome'), { target: { value: 'Rui Costa' } })
    fireEvent.input(within(dialog).getByLabelText('Número'), { target: { value: '777' } })
    fireEvent.input(within(dialog).getByLabelText('Data de nascimento'), { target: { value: '1995-02-03' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar beneficiário' }))
    expect(await screen.findByText(/Beneficiário criado \(cartão AUR-000004\)/)).toBeInTheDocument()
    expect(db.insurerOps.beneficiaries.find((b) => b.name === 'Rui Costa')?.status).toBe('PENDING')
  })

  it('suspender exige nota; ativar não', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/beneficiaries')
    await screen.findAllByText('João Mendes')
    fireEvent.click(screen.getByRole('button', { name: /^Suspender João Mendes/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }))
    expect(await within(dialog).findByText('Indique o motivo.')).toBeInTheDocument()
    fireEvent.input(within(dialog).getByLabelText('Motivo (obrigatório)'), { target: { value: 'Prémio em atraso' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }))
    expect(await screen.findByText('Beneficiário suspenso.')).toBeInTheDocument()
    expect(await screen.findByText('Nota: Prémio em atraso')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Ativar João Mendes/ }))
    expect(await screen.findByText('João Mendes ativado.')).toBeInTheDocument()
    expect(db.insurerOps.beneficiaries.find((b) => b.id === 'ben_joao')?.status).toBe('ACTIVE')
  })

  it('código de reclamação: confirmação, mostrado uma só vez e some ao fechar', async () => {
    asInsurer(MANAGER)
    renderAt('/insurance/beneficiaries')
    await screen.findAllByText('Ana Mendes')
    fireEvent.click(screen.getByRole('button', { name: /^Código de reclamação de Ana Mendes/ }))
    expect(await screen.findByText('Emitir código de reclamação?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Emitir código' }))
    const code = await screen.findByText(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    const shown = code.textContent!
    expect(screen.getByText(/Só é mostrado agora/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Já copiei, fechar' }))
    await waitFor(() => expect(screen.queryByText(shown)).not.toBeInTheDocument())
    expect(document.body.textContent).not.toContain(shown)
  })
})

describe('listas: paginação e respostas inesperadas', () => {
  it('«Carregar mais» acrescenta a página seguinte (cursor)', async () => {
    for (let i = 0; i < 30; i++) {
      db.insurerOps.companies.push({ id: `cmp_${i}`, insurerId: 'ins_aurora', name: `Empresa ${String(i).padStart(2, '0')}`, taxId: `9${i}`, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' })
    }
    asInsurer(MANAGER)
    renderAt('/insurance/companies')
    await screen.findAllByText('Empresa 00')
    expect(screen.queryAllByText('Empresa 29')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect((await screen.findAllByText('Empresa 29')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })

  it('um estado desconhecido vindo da API não rebenta a página', async () => {
    ;(db.insurerOps.beneficiaries[0] as { status: string }).status = 'EM_REVISAO'
    asInsurer(ADMIN)
    renderAt('/insurance/beneficiaries')
    expect((await screen.findAllByText('EM_REVISAO')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ana Mendes').length).toBeGreaterThan(0)
  })
})

describe('importação', () => {
  const csv = [
    'name,idDocumentType,idDocumentNumber,birthDate,relationship,holderIdDocumentNumber,companyTaxId',
    'Novo Titular,BI,111,1990-05-05,HOLDER,,',
    'Duplicado,BI,000111222LA042,1980-01-01,HOLDER,,',
    'Sem data,BI,333,,HOLDER,,',
  ].join('\n')

  it('carregar → pré-visualização com erros por linha → confirmar', async () => {
    asInsurer(MANAGER)
    renderAt('/insurance/imports')
    const input = await screen.findByLabelText('Ficheiro')
    fireEvent.change(input, { target: { files: [new File([csv], 'beneficiarios.csv', { type: 'text/csv' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Carregar e pré-visualizar' }))

    expect(await screen.findByText('Erros por linha')).toBeInTheDocument()
    expect(screen.getByText('Linha 3')).toBeInTheDocument()
    expect(screen.getByText('Documento já existe na seguradora')).toBeInTheDocument()
    expect(screen.getByText('Linha 4')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Novo Titular')).toBeInTheDocument()
    expect(db.insurerOps.beneficiaries).toHaveLength(3) // nada gravado ainda

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar importação (1)' }))
    expect(await screen.findByText(/1 beneficiários importados como pendentes; 2 linhas ignoradas \(1 duplicadas\)/)).toBeInTheDocument()
    expect(db.insurerOps.beneficiaries).toHaveLength(4)
  })

  it('recusa tipos de ficheiro inválidos no cliente e permite cancelar o lote', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/imports')
    fireEvent.change(await screen.findByLabelText('Ficheiro'), { target: { files: [new File(['x'], 'lista.pdf')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Carregar e pré-visualizar' }))
    expect(await screen.findByText('Tipo de ficheiro não permitido. Use CSV ou XLSX.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Ficheiro'), { target: { files: [new File([csv], 'b.csv')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Carregar e pré-visualizar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar lote' }))
    expect(await screen.findByText('Lote cancelado.')).toBeInTheDocument()
    expect(db.insurerOps.beneficiaries).toHaveLength(3)
  })
})

describe('ligações de cartão', () => {
  it('confirmar e rejeitar (motivo obrigatório)', async () => {
    db.insurerOps.linkRequests.push({
      id: 'lnk_pedro', insurerId: 'ins_aurora', beneficiaryId: 'ben_pedro', beneficiaryName: 'Pedro Quimbo',
      cardNumber: 'AUR-000003', status: 'PENDING', requestedAt: '2026-11-11T10:00:00.000Z', decidedAt: null, decisionNote: null,
    })
    asInsurer(MANAGER)
    renderAt('/insurance/links')
    await screen.findAllByText('Ana Mendes')
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar ligação de Ana Mendes/ }))
    expect(await screen.findByText('Ligação de Ana Mendes confirmada.')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /^Rejeitar ligação de Pedro Quimbo/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rejeitar ligação' }))
    expect(await within(dialog).findByText('Indique o motivo.')).toBeInTheDocument()
    fireEvent.input(within(dialog).getByLabelText('Motivo (obrigatório)'), { target: { value: 'Dados não coincidem' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rejeitar ligação' }))
    expect(await screen.findByText('Ligação rejeitada.')).toBeInTheDocument()
    expect(db.insurerOps.linkRequests.find((l) => l.id === 'lnk_pedro')).toMatchObject({ status: 'REJECTED', decisionNote: 'Dados não coincidem' })
  })
})

describe('planos, serviços e clínicas', () => {
  it('Admin edita coberturas de um plano em rascunho e ativa-o; kwanza formatado', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/plans/pln_plus')
    expect(await screen.findByRole('heading', { name: /Plano Plus · versão 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar plano' })).toBeDisabled()
    const group = await screen.findByRole('group', { name: 'Cobertura de Hemograma completo' })
    fireEvent.change(within(group).getByLabelText('Cobertura'), { target: { value: 'covered' } })
    fireEvent.input(within(group).getByLabelText('% paga pela seguradora'), { target: { value: '90' } })
    fireEvent.input(within(group).getByLabelText(/Teto anual/), { target: { value: '75000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar coberturas' }))
    expect(await screen.findByText('Coberturas guardadas.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ativar plano' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Ativar plano' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar' }))
    expect(await screen.findByText('Plano ativado.')).toBeInTheDocument()
    // Já ativo: só leitura, com o teto em Kz.
    expect(await screen.findByText('75 000,00 Kz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar coberturas' })).not.toBeInTheDocument()
  })

  it('validação das coberturas: percentagem fora de 0–100', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/plans/pln_plus')
    const group = await screen.findByRole('group', { name: 'Cobertura de Radiografia' })
    fireEvent.change(within(group).getByLabelText('Cobertura'), { target: { value: 'covered' } })
    fireEvent.input(within(group).getByLabelText('% paga pela seguradora'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar coberturas' }))
    expect(await screen.findByText(/a percentagem paga deve estar entre 0 e 100/)).toBeInTheDocument()
  })

  it('Gestor vê o plano em leitura (sem edição) e a lista de serviços sem ações de escrita', async () => {
    asInsurer(MANAGER)
    renderAt('/insurance/plans/pln_basico')
    expect(await screen.findByText('120 000,00 Kz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arquivar plano' })).not.toBeInTheDocument()
    cleanup()
    renderAt('/insurance/services')
    expect(await screen.findByText('Hemograma completo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo serviço' })).not.toBeInTheDocument()
  })

  it('Admin cria um serviço; código repetido é recusado', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/services')
    fireEvent.click(await screen.findByRole('button', { name: 'Novo serviço' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.input(within(dialog).getByLabelText('Código'), { target: { value: 'CONS-GER' } })
    fireEvent.input(within(dialog).getByLabelText('Nome'), { target: { value: 'Outra' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar serviço' }))
    expect(await within(dialog).findByText('Já existe um serviço com este código.')).toBeInTheDocument()
    fireEvent.input(within(dialog).getByLabelText('Código'), { target: { value: 'ECO-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar serviço' }))
    expect(await screen.findByText('Serviço criado.')).toBeInTheDocument()
    dialog = screen.queryByRole('dialog') as HTMLElement
    expect(await screen.findByText('ECO-01')).toBeInTheDocument()
  })

  it('Admin liga uma clínica parceira escolhendo na lista e suspende a ligação', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/providers')
    expect((await screen.findAllByText('Clínica Horizonte')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Ligar clínica' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Laboratório Vida Plena' })
    expect(within(dialog).queryByRole('option', { name: /Centro de Saúde do Bairro/ })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Clínica parceira'), { target: { value: 'cln_vidaplena' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ligar clínica' }))
    expect(await screen.findByText('Clínica ligada.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /^Suspender Laboratório Vida Plena/ }))
    expect(await screen.findByText('Ligação suspensa.')).toBeInTheDocument()
  })

  it('Admin cria conta de Gestor de beneficiários', async () => {
    asInsurer(ADMIN)
    renderAt('/insurance/agents')
    fireEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.input(within(dialog).getByLabelText('E-mail'), { target: { value: 'novo@aurora.pt' } })
    fireEvent.change(within(dialog).getByLabelText('Papel'), { target: { value: 'BENEFICIARY_MANAGER' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText('Conta de novo@aurora.pt criada.')).toBeInTheDocument()
    expect(db.insuranceAccounts.find((a) => a.email === 'novo@aurora.pt')?.role).toBe('BENEFICIARY_MANAGER')
  })
})

describe('portal da clínica: validação de beneficiário', () => {
  it('Médico não vê o item nem acede à rota', async () => {
    asClinic('cac_horizonte_medica')
    const router = renderAt('/clinic/insurers')
    await waitFor(() => expect(router.state.location.pathname).toBe('/clinic'))
    expect(screen.queryByRole('link', { name: 'Seguradoras' })).not.toBeInTheDocument()
  })

  it('Gestor vê o item; valida um cartão elegível e vê o aviso de que não garante pagamento', async () => {
    asClinic('cac_horizonte_rececao')
    renderAt('/clinic/insurers')
    expect(await screen.findByText(/Seguradora Aurora/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Seguradoras' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('note')).toHaveTextContent('Verificação de cobertura, não garantia de pagamento.')

    type('Número do cartão', 'AUR-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText('Elegível')).toBeInTheDocument()
    expect(screen.getByText('João Mendes')).toBeInTheDocument()
    expect(screen.getByText('Plano Básico')).toBeInTheDocument()
    expect(screen.getByText('50 000,00 Kz')).toBeInTheDocument()
    expect(screen.getByText('Exige autorização')).toBeInTheDocument()
    expect(screen.getAllByText(/não garantia de pagamento/).length).toBeGreaterThan(1)
  })

  it('não elegível: resposta mínima e igual para cartão inexistente', async () => {
    asClinic('cac_horizonte_admin')
    renderAt('/clinic/insurers')
    await screen.findByLabelText('Número do cartão')
    type('Número do cartão', 'NAO-EXISTE')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText('Não elegível')).toBeInTheDocument()
    expect(screen.queryByText('Plano Básico')).not.toBeInTheDocument()
  })

  it('identifica por QR e por documento; exige o identificador', async () => {
    asClinic('cac_horizonte_admin')
    renderAt('/clinic/insurers')
    await screen.findByLabelText('Número do cartão')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText('Indique o número do cartão.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Código QR' }))
    type('Código do QR do cartão', 'qr.ins_aurora.AUR-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText('Elegível')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Documento' }))
    expect(screen.queryByText('Elegível')).not.toBeInTheDocument()
    type('Nº do documento', '000333444LA051')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText('Ana Mendes')).toBeInTheDocument()
  })

  it('rate limit (429): mensagem com os segundos do Retry-After e botão em espera', async () => {
    db.insurerOps.eligibilityChecks.cln_horizonte = Array.from({ length: ELIGIBILITY_LIMIT }, () => Date.now())
    asClinic('cac_horizonte_admin')
    renderAt('/clinic/insurers')
    await screen.findByLabelText('Número do cartão')
    type('Número do cartão', 'AUR-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Validar cobertura' }))
    expect(await screen.findByText(/Aguarde 30 segundos antes de tentar de novo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aguarde \d+ s/ })).toBeDisabled()
  })

  it('lista de serviços da seguradora: só ativos, com pesquisa', async () => {
    asClinic('cac_horizonte_rececao')
    renderAt('/clinic/insurers')
    fireEvent.click(await screen.findByRole('tab', { name: 'Serviços' }))
    expect(await screen.findByText('Hemograma completo')).toBeInTheDocument()
    expect(screen.queryByText('Serviço descontinuado')).not.toBeInTheDocument()
    type('Código ou nome', 'radio')
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }))
    await waitFor(() => expect(screen.queryByText('Hemograma completo')).not.toBeInTheDocument())
    expect(await screen.findByText('Radiografia')).toBeInTheDocument()
  })

  it('clínica sem seguradoras ligadas: estado vazio', async () => {
    db.insurerOps.providers = []
    asClinic('cac_horizonte_admin')
    renderAt('/clinic/insurers')
    expect(await screen.findByText('Sem seguradoras ligadas.')).toBeInTheDocument()
  })
})
