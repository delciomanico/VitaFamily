import { beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import { DEMO_INVITATION_CODE } from '../data/families'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_VERIFICATION_CODE } from '../data/users'
import { db, resetDb } from '../db'
import * as auth from './auth'
import * as family from './family'
import * as health from './health'

const newAccount = {
  name: 'Ana Teste',
  email: 'Ana@Exemplo.test',
  birthDate: '1990-01-01',
  password: 'uma-frase-longa',
  timezone: 'Africa/Luanda',
  termsVersion: '2026-01',
}

const code = (promise: Promise<unknown>) => promise.then(() => 'OK', (e: AppError) => e.code)

beforeEach(() => resetDb())

describe('auth', () => {
  it('entra com as credenciais demo e não devolve a palavra-passe', async () => {
    const user = await auth.login({ email: ` ${DEMO_EMAIL.toUpperCase()} `, password: DEMO_PASSWORD })
    expect(user.email).toBe(DEMO_EMAIL)
    expect(user).not.toHaveProperty('password')
  })

  it('recusa credenciais inválidas com erro genérico', async () => {
    expect(await code(auth.login({ email: DEMO_EMAIL, password: 'errada' }))).toBe('INVALID_CREDENTIALS')
    expect(await code(auth.login({ email: 'ninguem@x.test', password: 'x' }))).toBe('INVALID_CREDENTIALS')
  })

  it('regista conta por verificar, que só entra depois do código', async () => {
    await auth.register(newAccount)
    expect(await code(auth.login({ email: newAccount.email, password: newAccount.password }))).toBe('EMAIL_NOT_VERIFIED')
    expect(await code(auth.verifyEmail('ana@exemplo.test', '000000'))).toBe('INVALID_CODE')
    const user = await auth.verifyEmail('ana@exemplo.test', DEMO_VERIFICATION_CODE)
    expect(user.status).toBe('ACTIVE')
  })

  it('recusa menores de 18 e palavras-passe curtas', async () => {
    expect(await code(auth.register({ ...newAccount, birthDate: '2015-01-01' }))).toBe('AGE_REQUIREMENT_NOT_MET')
    expect(await code(auth.register({ ...newAccount, password: 'curta' }))).toBe('PASSWORD_WEAK')
  })

  it('responde igual a um e-mail já registado, sem criar outra conta', async () => {
    const before = db.users.length
    await expect(auth.register({ ...newAccount, email: DEMO_EMAIL })).resolves.toBeUndefined()
    expect(db.users).toHaveLength(before)
  })
})

describe('family', () => {
  it('cria a família com o próprio utilizador como Admin', async () => {
    await auth.register(newAccount)
    const user = await auth.verifyEmail('ana@exemplo.test', DEMO_VERIFICATION_CODE)
    const { family: created, member } = await family.createFamily(user.id, 'Família Teste')
    expect(created.name).toBe('Família Teste')
    expect(member).toMatchObject({ userId: user.id, role: 'FAMILY_ADMIN', relationship: 'SELF' })
  })

  it('entra por convite uma única vez', async () => {
    await auth.register(newAccount)
    const user = await auth.verifyEmail('ana@exemplo.test', DEMO_VERIFICATION_CODE)
    const { member } = await family.joinFamily(user.id, DEMO_INVITATION_CODE.toLowerCase())
    expect(member.role).toBe('FAMILY_MEMBER')
    expect(await code(family.joinFamily(user.id, DEMO_INVITATION_CODE))).toBe('INVITATION_INVALID')
  })

  it('só o Admin adiciona ou remove membros', async () => {
    const added = await family.addMember('fam_monarca', 'usr_monarca', {
      name: 'Rita Lopes',
      birthDate: '2020-06-01',
      relationship: 'DAUGHTER',
    })
    expect(added.isDependent).toBe(true)

    await auth.register(newAccount)
    const other = await auth.verifyEmail('ana@exemplo.test', DEMO_VERIFICATION_CODE)
    await family.joinFamily(other.id, DEMO_INVITATION_CODE)
    expect(await code(family.removeMember('fam_monarca', other.id, added.id))).toBe('FORBIDDEN')
    expect(await code(family.removeMember('fam_monarca', 'usr_monarca', added.id))).toBe('OK')
  })
})

describe('health', () => {
  it('não expõe perfis de outra família', async () => {
    expect(await code(health.getHealthProfile('fam_outra', 'mem_maria'))).toBe('NOT_FOUND')
  })

  it('guarda o perfil e substitui alergias e condições', async () => {
    const profile = await health.saveHealthProfile('fam_monarca', 'mem_maria', {
      name: 'Maria Lopes',
      birthDate: '1987-05-20',
      bloodType: 'A-',
      allergies: ['Látex'],
      conditions: [],
    })
    expect(profile.member.bloodType).toBe('A-')
    expect(profile.allergies.map((a) => a.name)).toEqual(['Látex'])
    expect(profile.conditions).toEqual([])
  })
})
