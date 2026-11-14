import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as ops from './insurerOps'

const ADMIN = 'iac_aurora_admin'
const MANAGER = 'iac_aurora_manager'
const AGENT = 'iac_aurora_agent'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb())

describe('módulo operacional: acesso (matriz §8.2b)', () => {
  it('o Agente não acede (FORBIDDEN); Admin e Gestor leem', async () => {
    expect(await code(ops.listBeneficiaries(AGENT))).toBe('FORBIDDEN')
    expect((await ops.listBeneficiaries(ADMIN)).items.length).toBe(3)
    expect((await ops.listBeneficiaries(MANAGER)).items.length).toBe(3)
  })

  it('módulo desativado ⇒ NOT_FOUND', async () => {
    db.insurerOps.modules.ins_aurora!.enabled = false
    expect(await code(ops.listCompanies(ADMIN))).toBe('NOT_FOUND')
    expect(await code(ops.listServices(MANAGER))).toBe('NOT_FOUND')
  })

  it('o Gestor lê planos e serviços mas só o Admin escreve; clínicas só do Admin', async () => {
    expect((await ops.listPlans(MANAGER)).items.length).toBe(2)
    expect(await code(ops.createPlan(MANAGER, { name: 'X' }))).toBe('FORBIDDEN')
    expect(await code(ops.createService(MANAGER, { code: 'A', name: 'A' }))).toBe('FORBIDDEN')
    expect(await code(ops.listPartnerClinics(MANAGER))).toBe('FORBIDDEN')
    expect((await ops.listPartnerClinics(ADMIN)).items.map((c) => c.name)).toContain('Clínica Horizonte')
    // Clínica privada de uma família nunca aparece.
    expect((await ops.listPartnerClinics(ADMIN)).items.map((c) => c.name)).not.toContain('Centro de Saúde do Bairro')
  })

  it('isola seguradoras: dados de outra seguradora não existem', async () => {
    db.insurers.push({ id: 'ins_b', name: 'B', taxId: '500000001', status: 'ACTIVE' })
    db.insurerOps.modules.ins_b = { enabled: true, currency: 'AOA' }
    db.insuranceAccounts.push({ id: 'iac_b', insurerId: 'ins_b', email: 'b@b.pt', password: 'x', role: 'INSURANCE_ADMIN', status: 'ACTIVE' })
    expect((await ops.listBeneficiaries('iac_b')).items).toEqual([])
    expect(await code(ops.getBeneficiary('iac_b', 'ben_joao'))).toBe('NOT_FOUND')
  })
})

describe('beneficiários', () => {
  it('cria PENDING com cartão gerado; documento repetido ⇒ CONFLICT; dependente exige titular', async () => {
    const created = await ops.createBeneficiary(MANAGER, {
      name: ' Rui ',
      idDocumentType: 'BI',
      idDocumentNumber: '999',
      birthDate: '2000-01-01',
      relationship: 'HOLDER',
    })
    expect(created).toMatchObject({ name: 'Rui', status: 'PENDING', linked: false })
    expect(created.cardNumber).toMatch(/^AUR-\d{6}$/)
    expect(Object.keys(created)).not.toContain('insurerId')
    expect(await code(ops.createBeneficiary(MANAGER, { name: 'Rui2', idDocumentType: 'BI', idDocumentNumber: '999', birthDate: '2000-01-01', relationship: 'HOLDER' }))).toBe('CONFLICT')
    expect(await code(ops.createBeneficiary(MANAGER, { name: 'D', idDocumentType: 'BI', idDocumentNumber: '1', birthDate: '2010-01-01', relationship: 'CHILD' }))).toBe('VALIDATION_ERROR')
  })

  it('estados: suspender/cancelar exigem nota; cancelado é final; ativar sem nota', async () => {
    expect(await code(ops.setBeneficiaryStatus(MANAGER, 'ben_joao', 'SUSPENDED'))).toBe('VALIDATION_ERROR')
    expect((await ops.setBeneficiaryStatus(MANAGER, 'ben_joao', 'SUSPENDED', ' férias ')).statusNote).toBe('férias')
    expect((await ops.setBeneficiaryStatus(MANAGER, 'ben_joao', 'ACTIVE')).statusNote).toBeNull()
    await ops.setBeneficiaryStatus(MANAGER, 'ben_joao', 'CANCELLED', 'saiu')
    expect(await code(ops.setBeneficiaryStatus(MANAGER, 'ben_joao', 'ACTIVE'))).toBe('CONFLICT')
    expect(await code(ops.issueClaimCode(MANAGER, 'ben_joao'))).toBe('CONFLICT')
  })

  it('código de reclamação: em claro, novo de cada vez', async () => {
    const a = await ops.issueClaimCode(MANAGER, 'ben_ana')
    const b = await ops.issueClaimCode(MANAGER, 'ben_ana')
    expect(a.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    expect(a.code).not.toBe(b.code)
  })

  it('pesquisa por nome, cartão e documento exato; pagina por cursor', async () => {
    expect((await ops.listBeneficiaries(ADMIN, { q: 'ana' })).items.map((b) => b.id)).toEqual(['ben_ana'])
    expect((await ops.listBeneficiaries(ADMIN, { q: 'AUR-000003' })).items.map((b) => b.id)).toEqual(['ben_pedro'])
    expect((await ops.listBeneficiaries(ADMIN, { q: '000111222LA042' })).items.map((b) => b.id)).toEqual(['ben_joao'])
    expect((await ops.listBeneficiaries(ADMIN, { q: '000111' })).items).toEqual([])
    const first = await ops.listBeneficiaries(ADMIN, { limit: 2 })
    expect(first.items.length).toBe(2)
    expect(first.nextCursor).toBe('2')
    const second = await ops.listBeneficiaries(ADMIN, { limit: 2, cursor: first.nextCursor! })
    expect(second.items.length).toBe(1)
    expect(second.nextCursor).toBeNull()
  })
})

describe('importação (BR-SEG-17)', () => {
  const header = 'name,idDocumentType,idDocumentNumber,birthDate,relationship,holderIdDocumentNumber,companyTaxId'

  it('pré-visualiza sem gravar, reporta erros por linha e confirma só as válidas', async () => {
    const text = [
      header,
      'Novo Titular,BI,111,1990-05-05,HOLDER,,',
      'Dependente,BI,222,2015-05-05,CHILD,111,',
      'Duplicado,BI,000111222LA042,1980-01-01,HOLDER,,',
      'Sem data,BI,333,,HOLDER,,',
      'Órfão,BI,444,2000-01-01,SPOUSE,999999,',
    ].join('\n')
    const preview = await ops.createImport(ADMIN, { name: 'b.csv', text })
    expect(preview).toMatchObject({ status: 'PREVIEW', rowCount: 5, validRows: 2, errorRows: 3, duplicateRows: 1 })
    expect(preview.errors.map((e) => [e.row, e.code])).toEqual([
      [4, 'DUPLICATE_EXISTING'],
      [5, 'INVALID_FORMAT'],
      [6, 'HOLDER_NOT_FOUND'],
    ])
    expect(db.insurerOps.beneficiaries.length).toBe(3) // nada gravado
    const done = await ops.commitImport(ADMIN, preview.id)
    expect(done).toMatchObject({ status: 'COMMITTED', importedRows: 2, errorRows: 3, duplicateRows: 1 })
    expect(db.insurerOps.beneficiaries.length).toBe(5)
    expect(db.insurerOps.beneficiaries.filter((b) => b.status === 'PENDING').length).toBe(3)
    expect(await code(ops.commitImport(ADMIN, preview.id))).toBe('CONFLICT')
    expect(await code(ops.cancelImport(ADMIN, preview.id))).toBe('CONFLICT')
  })

  it('aceita separador ";", recusa XLSX no mock e ficheiros sem cabeçalho', async () => {
    const semi = header.replaceAll(',', ';') + '\nA;BI;5;1990-01-01;HOLDER;;'
    expect((await ops.createImport(ADMIN, { name: 'a.csv', text: semi })).validRows).toBe(1)
    expect(await code(ops.createImport(ADMIN, { name: 'a.xlsx', text: '' }))).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(await code(ops.createImport(ADMIN, { name: 'a.csv', text: 'x,y\n1,2' }))).toBe('VALIDATION_ERROR')
  })

  it('cancelar um lote em pré-visualização', async () => {
    const preview = await ops.createImport(ADMIN, { name: 'a.csv', text: `${header}\nA,BI,5,1990-01-01,HOLDER,,` })
    await ops.cancelImport(ADMIN, preview.id)
    expect(await code(ops.commitImport(ADMIN, preview.id))).toBe('CONFLICT')
  })
})

describe('ligações, planos, serviços, apólices e clínicas', () => {
  it('confirmar marca o beneficiário como ligado; rejeitar exige motivo; decidido não volta a decidir', async () => {
    expect((await ops.listLinkRequests(ADMIN)).items.length).toBe(1)
    expect(await code(ops.rejectLinkRequest(ADMIN, 'lnk_ana', ' '))).toBe('VALIDATION_ERROR')
    await ops.confirmLinkRequest(ADMIN, 'lnk_ana')
    expect(db.insurerOps.beneficiaries.find((b) => b.id === 'ben_ana')!.linked).toBe(true)
    expect(await code(ops.confirmLinkRequest(ADMIN, 'lnk_ana'))).toBe('CONFLICT')
    expect((await ops.listLinkRequests(ADMIN)).items).toEqual([])
    expect((await ops.listLinkRequests(ADMIN, { status: 'CONFIRMED' })).items.length).toBe(1)
  })

  it('planos: ativar exige coberturas; nova versão copia coberturas; ativo não se edita', async () => {
    expect(await code(ops.setPlanStatus(ADMIN, 'pln_plus', 'ACTIVE'))).toBe('CONFLICT')
    expect(await code(ops.replacePlanCoverages(ADMIN, 'pln_basico', []))).toBe('CONFLICT')
    await ops.replacePlanCoverages(ADMIN, 'pln_plus', [
      { serviceId: 'svc_cons', covered: true, copayPct: 90, limitPerYear: null, waitingDays: 0, requiresAuthorization: false },
    ])
    expect((await ops.setPlanStatus(ADMIN, 'pln_plus', 'ACTIVE')).coverageCount).toBe(1)
    const v2 = await ops.newPlanVersion(ADMIN, 'pln_basico')
    expect(v2).toMatchObject({ version: 2, status: 'DRAFT', coverageCount: 3 })
    expect(await code(ops.newPlanVersion(ADMIN, 'pln_basico'))).toBe('CONFLICT')
    expect(await code(ops.replacePlanCoverages(ADMIN, v2.id, [{ serviceId: 'x', covered: true, copayPct: 1, limitPerYear: null, waitingDays: 0, requiresAuthorization: false }]))).toBe('VALIDATION_ERROR')
  })

  it('serviços: código único; apólices: número único e transições com nota', async () => {
    expect(await code(ops.createService(ADMIN, { code: ' cons-ger ', name: 'x' }))).toBe('CONFLICT')
    const policy = await ops.createPolicy(MANAGER, { planId: 'pln_basico', holderId: 'ben_pedro', number: 'AP-9', validFrom: '2026-01-01', validTo: '2026-12-31' })
    expect(policy.status).toBe('DRAFT')
    expect(await code(ops.createPolicy(MANAGER, { planId: 'pln_basico', holderId: 'ben_pedro', number: 'AP-9', validFrom: '2026-01-01', validTo: '2026-12-31' }))).toBe('CONFLICT')
    expect(await code(ops.createPolicy(MANAGER, { planId: 'pln_basico', holderId: 'ben_ana', number: 'AP-10', validFrom: '2026-01-01', validTo: '2026-12-31' }))).toBe('VALIDATION_ERROR') // dependente
    expect((await ops.setPolicyStatus(MANAGER, policy.id, 'ACTIVE')).status).toBe('ACTIVE')
    expect(await code(ops.setPolicyStatus(MANAGER, policy.id, 'CANCELLED'))).toBe('VALIDATION_ERROR')
    expect((await ops.setPolicyStatus(MANAGER, policy.id, 'CANCELLED', 'erro')).statusNote).toBe('erro')
  })

  it('ligar clínica: só parceira e ativa; repetida ⇒ CONFLICT; suspender', async () => {
    expect(await code(ops.createProvider(ADMIN, 'cln_horizonte'))).toBe('CONFLICT')
    expect(await code(ops.createProvider(ADMIN, 'cln_bairro'))).toBe('NOT_FOUND')
    const linked = await ops.createProvider(ADMIN, 'cln_vidaplena')
    expect((await ops.setProviderStatus(ADMIN, linked.id, 'SUSPENDED')).status).toBe('SUSPENDED')
  })
})

describe('filtro relationship (GET /insurance-portal/beneficiaries)', () => {
  it('combina com q', async () => {
    const holders = await ops.listBeneficiaries(MANAGER, { relationship: 'HOLDER' })
    expect(holders.items.map((b) => b.id)).toEqual(['ben_joao', 'ben_pedro'])
    expect((await ops.listBeneficiaries(MANAGER, { relationship: 'HOLDER', q: 'mendes' })).items.map((b) => b.id)).toEqual(['ben_joao'])
  })
})
