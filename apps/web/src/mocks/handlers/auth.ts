import { ageOn } from '@/lib/date'
import { AppError } from '@/lib/errors'
import { ADULT_AGE, PASSWORD_MIN_LENGTH } from '@/lib/policy'
import type { User } from '@/types/user'
import { DEMO_VERIFICATION_CODE, type MockUserRecord } from '../data/users'
import { db, newId } from '../db'
import { respond } from '../respond'

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  birthDate: string
  password: string
  timezone: string
  termsVersion: string
}

function toUser({ id, email, name, birthDate, timezone, status }: MockUserRecord): User {
  return { id, email, name, birthDate, timezone, status }
}

function findByEmail(email: string) {
  return db.users.find((u) => u.email === email.trim().toLowerCase())
}

export function login({ email, password }: LoginInput) {
  return respond(() => {
    const record = findByEmail(email)
    if (!record || record.password !== password) throw new AppError('INVALID_CREDENTIALS')
    if (record.status === 'PENDING_VERIFICATION') throw new AppError('EMAIL_NOT_VERIFIED')
    if (record.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED')
    return toUser(record)
  })
}

/**
 * Cria conta por verificar. Se o e-mail já existir, responde da mesma forma
 * sem revelar a existência da conta (UC-ACC-01).
 */
export function register(input: RegisterInput) {
  return respond(() => {
    if (ageOn(input.birthDate) < ADULT_AGE) throw new AppError('AGE_REQUIREMENT_NOT_MET')
    if (input.password.length < PASSWORD_MIN_LENGTH) throw new AppError('PASSWORD_WEAK')
    if (findByEmail(input.email)) return undefined

    db.users.push({
      id: newId('usr'),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      name: input.name.trim(),
      birthDate: input.birthDate,
      timezone: input.timezone,
      status: 'PENDING_VERIFICATION',
    })
    return undefined
  })
}

export function verifyEmail(email: string, code: string) {
  return respond(() => {
    const record = findByEmail(email)
    if (!record || record.status !== 'PENDING_VERIFICATION' || code !== DEMO_VERIFICATION_CODE) {
      throw new AppError('INVALID_CODE')
    }
    record.status = 'ACTIVE'
    return toUser(record)
  })
}

/** Reenvio e recuperação respondem sempre igual, exista ou não a conta. */
export function resendVerificationCode(_email: string) {
  return respond(() => undefined)
}

export function requestPasswordReset(_email: string) {
  return respond(() => undefined)
}

export function getUser(userId: string) {
  return respond(() => {
    const record = db.users.find((u) => u.id === userId && u.status === 'ACTIVE')
    return record ? toUser(record) : null
  })
}
