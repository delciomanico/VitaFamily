import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as admin from './admin'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const ADMIN_ID = db.users.find((u) => u.platformRole === 'PLATFORM_ADMIN')!.id
const OTHER_ID = db.users.find((u) => u.platformRole !== 'PLATFORM_ADMIN')!.id

beforeEach(() => resetDb())

describe('admin: utilizadores', () => {
  it('pesquisa por e-mail ou nome e recusa 1 carácter', async () => {
    const all = await admin.adminListUsers()
    const hit = await admin.adminListUsers(undefined, all.items[0]!.email.slice(0, 4))
    expect(hit.items.length).toBeGreaterThan(0)
    expect(await code(admin.adminListUsers(undefined, 'a'))).toBe('VALIDATION_ERROR')
  })

  it('detalhe operacional sem dados de saúde', async () => {
    const detail = await admin.adminGetUser(OTHER_ID)
    expect(typeof detail.familiesCount).toBe('number')
    expect(Object.keys(detail)).not.toContain('families')
    expect(await code(admin.adminGetUser('nope'))).toBe('NOT_FOUND')
  })

  it('repor acesso nunca na própria conta', async () => {
    expect(await code(admin.adminResetUserAccess(ADMIN_ID, ADMIN_ID))).toBe('FORBIDDEN')
    expect(await code(admin.adminResetUserAccess(ADMIN_ID, OTHER_ID))).toBe('OK')
  })
})

describe('admin: contas de clínica', () => {
  const CLINIC = 'cln_horizonte'

  it('lista, suspende com motivo e reativa', async () => {
    const accounts = await admin.adminListClinicAccounts(CLINIC)
    const target = accounts.find((a) => a.role === 'CLINIC_MANAGER')!
    expect(await code(admin.adminSuspendClinicAccount(CLINIC, target.id, '  '))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminSuspendClinicAccount(CLINIC, target.id, 'Saiu da clínica'))).toBe('OK')
    expect((await admin.adminListClinicAccounts(CLINIC)).find((a) => a.id === target.id)?.status).toBe('SUSPENDED')
    expect(await code(admin.adminReactivateClinicAccount(CLINIC, target.id))).toBe('OK')
  })

  it('conta de outra clínica dá NOT_FOUND', async () => {
    const target = (await admin.adminListClinicAccounts(CLINIC))[0]!
    expect(await code(admin.adminSuspendClinicAccount('cln_outra', target.id, 'x'))).toBe('NOT_FOUND')
  })

  it('reativar CLINIC_ADMIN com outro ativo dá CONFLICT', async () => {
    const root = db.clinicAccounts.find((a) => a.clinicId === CLINIC && a.role === 'CLINIC_ADMIN')!
    db.clinicAccounts.push({ ...root, id: 'cac_extra', email: 'x@y.pt', status: 'SUSPENDED' })
    expect(await code(admin.adminReactivateClinicAccount(CLINIC, 'cac_extra'))).toBe('CONFLICT')
  })
})

describe('admin: seguradoras', () => {
  it('cria, rejeita NIF duplicado ou inválido, edita e suspende', async () => {
    const created = await admin.adminCreateInsurer({ name: ' Nova ', taxId: '500999888' })
    expect(created).toMatchObject({ name: 'Nova', status: 'ACTIVE' })
    expect(await code(admin.adminCreateInsurer({ name: 'Outra', taxId: '500999888' }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminCreateInsurer({ name: 'X', taxId: '123' }))).toBe('VALIDATION_ERROR')
    expect((await admin.adminUpdateInsurer(created.id, { name: 'Renomeada' })).name).toBe('Renomeada')
    expect((await admin.adminSetInsurerStatus(created.id, 'SUSPENDED')).status).toBe('SUSPENDED')
    expect((await admin.adminListInsurers()).some((i) => i.id === created.id)).toBe(true)
  })

  it('conta raiz é idempotente e rejeita e-mail de outra conta', async () => {
    const first = await admin.adminCreateOrResetInsurerRootAccount('ins_aurora', 'novo@aurora.pt')
    const again = await admin.adminCreateOrResetInsurerRootAccount('ins_aurora', 'outro@aurora.pt')
    expect(again.id).toBe(first.id)
    expect(await code(admin.adminCreateOrResetInsurerRootAccount('ins_aurora', 'agente@seguradoraaurora.pt'))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await code(admin.adminCreateOrResetInsurerRootAccount('nope', 'a@b.pt'))).toBe('NOT_FOUND')
  })
})
