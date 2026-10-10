import { AppError } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ChangePasswordInput,
  type DataExport,
  type NotificationPreferences,
  type UpdateAccountInput,
} from '@/types/settings'
import type { User } from '@/types/user'
import { db, newId, type MockExport } from '../db'
import { respond } from '../respond'

/*
 * A minha conta (UC-ACC-04/05/06): perfil, palavra-passe, preferências de alertas,
 * exportação e eliminação. Tudo só do próprio utilizador.
 */

/** Máximo de exportações pedidas em 24 h (endpoints → requestMyExport). */
export const EXPORTS_PER_DAY = 3
/** Validade do pacote exportado (endpoints → downloadMyExport). */
export const EXPORT_VALID_DAYS = 7

const DAY_MS = 86_400_000

function requireUser(userId: string) {
  const user = db.users.find((u) => u.id === userId)
  if (!user) throw new AppError('NOT_FOUND')
  return user
}

const toUser = ({ password: _password, ...user }: (typeof db.users)[number]): User => user

/** Fusos válidos para o navegador (IANA). */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-PT', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Alterar nome e fuso horário (UC-ACC-04). O nome do membro na família acompanha o da conta. */
export function updateMe(userId: string, input: UpdateAccountInput) {
  return respond((): User => {
    const user = requireUser(userId)
    const name = input.name.trim()
    if (name.length < 2 || !isTimeZone(input.timezone)) throw new AppError('VALIDATION_ERROR')
    user.name = name
    // TODO(BR-MED-08): com o backend, mudar o fuso recalcula as tomas futuras; os mocks usam o fuso do dispositivo.
    user.timezone = input.timezone
    for (const member of db.members.filter((m) => m.userId === userId)) member.name = name
    return toUser(user)
  })
}

/** Alterar a palavra-passe: confirma a atual; o backend termina as outras sessões. */
export function changePassword(userId: string, input: ChangePasswordInput) {
  return respond(() => {
    const user = requireUser(userId)
    if (user.password !== input.currentPassword) throw new AppError('INVALID_CREDENTIALS')
    if (input.newPassword.length < PASSWORD_MIN_LENGTH) throw new AppError('PASSWORD_WEAK')
    user.password = input.newPassword
  })
}

export function getNotificationPreferences(userId: string) {
  return respond((): NotificationPreferences => {
    requireUser(userId)
    const { userId: _id, ...preferences } = db.notificationPreferences.find((p) => p.userId === userId) ?? {
      userId,
      ...DEFAULT_NOTIFICATION_PREFERENCES,
    }
    return preferences
  })
}

/** Canais e tipos de alerta (UC-ALR-05). Desativar um tipo deixa de gerar esses alertas para si. */
export function putNotificationPreferences(userId: string, input: NotificationPreferences) {
  return respond((): NotificationPreferences => {
    requireUser(userId)
    db.notificationPreferences = [
      ...db.notificationPreferences.filter((p) => p.userId !== userId),
      { userId, ...input },
    ]
    return input
  })
}

const toExport = ({ userId: _userId, ...item }: MockExport): DataExport => item

/** As minhas exportações, mais recentes primeiro; as que passaram a validade ficam EXPIRED. */
export function listMyExports(userId: string, now: Date = new Date()) {
  return respond((): DataExport[] => {
    requireUser(userId)
    return db.exports
      .filter((e) => e.userId === userId)
      .map((e) => (e.expiresAt && Date.parse(e.expiresAt) <= now.getTime() ? { ...e, status: 'EXPIRED' as const } : e))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map(toExport)
  })
}

/** Pedir a exportação (UC-ACC-06). O backend gera-a em segundo plano; os mocks têm-na pronta logo. */
export function requestMyExport(userId: string, now: Date = new Date()) {
  return respond((): DataExport => {
    requireUser(userId)
    const recent = db.exports.filter((e) => e.userId === userId && Date.parse(e.requestedAt) > now.getTime() - DAY_MS)
    if (recent.length >= EXPORTS_PER_DAY) throw new AppError('RATE_LIMITED')
    const item: MockExport = {
      id: newId('exp'),
      userId,
      status: 'READY',
      reason: 'USER_REQUEST',
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPORT_VALID_DAYS * DAY_MS).toISOString(),
    }
    db.exports.push(item)
    return toExport(item)
  })
}

/**
 * Conteúdo da exportação: os dados de que o utilizador é titular (FR-PRIV-05).
 * Os documentos vão como metadados; o backend junta os ficheiros no pacote (Q6).
 */
export function downloadMyExport(userId: string, exportId: string, now: Date = new Date()) {
  return respond(() => {
    const user = requireUser(userId)
    const item = db.exports.find((e) => e.id === exportId && e.userId === userId)
    if (!item || (item.expiresAt && Date.parse(item.expiresAt) <= now.getTime())) throw new AppError('NOT_FOUND')
    const own = <T extends { memberId: string }>(items: T[], memberId: string) =>
      items.filter((i) => i.memberId === memberId)
    return {
      exportedAt: now.toISOString(),
      account: { name: user.name, email: user.email, birthDate: user.birthDate, timezone: user.timezone },
      families: db.members
        .filter((m) => m.userId === userId)
        .map((member) => {
          const examinations = own(db.examinations, member.id)
          return {
            family: db.families.find((f) => f.id === member.familyId)?.name,
            member: { name: member.name, birthDate: member.birthDate, bloodType: member.bloodType },
            allergies: own(db.allergies, member.id),
            conditions: own(db.conditions, member.id),
            prescriptions: own(db.prescriptions, member.id),
            medicationPlans: own(db.medicationPlans, member.id),
            doses: own(db.doses, member.id),
            appointments: own(db.appointments, member.id),
            examinations,
            examResults: db.examResults.filter((r) => examinations.some((e) => e.id === r.examinationId)),
            documents: own(db.documents, member.id),
          }
        }),
    }
  })
}

/**
 * Eliminar a conta (UC-ACC-05, BR-ACC-06/07): confirma a palavra-passe; bloqueada se for o único tutor
 * de um dependente ou o único Admin de uma família com outros membros. Apaga tudo o que é seu.
 */
export function deleteMe(userId: string, password: string) {
  return respond(() => {
    const user = requireUser(userId)
    if (user.password !== password) throw new AppError('INVALID_CREDENTIALS')
    const mine = db.members.filter((m) => m.userId === userId)
    const ids = new Set(mine.map((m) => m.id))

    const soleGuardian = db.guardianships.some(
      (g) =>
        ids.has(g.guardianId) &&
        !db.guardianships.some((o) => o.dependentId === g.dependentId && !ids.has(o.guardianId)),
    )
    const soleAdmin = mine.some((m) => {
      if (m.role !== 'FAMILY_ADMIN') return false
      const others = db.members.filter((o) => o.familyId === m.familyId && o.id !== m.id && o.status === 'ACTIVE')
      return others.length > 0 && !others.some((o) => o.role === 'FAMILY_ADMIN')
    })
    if (soleGuardian || soleAdmin) throw new AppError('ACCOUNT_DELETION_BLOCKED')

    const notMine = (item: { memberId: string }) => !ids.has(item.memberId)
    const examIds = new Set(db.examinations.filter((e) => ids.has(e.memberId)).map((e) => e.id))
    db.allergies = db.allergies.filter(notMine)
    db.conditions = db.conditions.filter(notMine)
    db.prescriptions = db.prescriptions.filter(notMine)
    db.medicationPlans = db.medicationPlans.filter(notMine)
    db.doses = db.doses.filter(notMine)
    db.appointments = db.appointments.filter(notMine)
    db.examResults = db.examResults.filter((r) => !examIds.has(r.examinationId))
    db.examinations = db.examinations.filter(notMine)
    db.documents = db.documents.filter(notMine)
    db.alerts = db.alerts.filter((a) => notMine(a) && a.recipientUserId !== userId)
    db.sharingGrants = db.sharingGrants.filter(
      (g) => !ids.has(g.ownerMemberId) && !(g.granteeMemberId && ids.has(g.granteeMemberId)),
    )
    db.guardianships = db.guardianships.filter((g) => !ids.has(g.guardianId) && !ids.has(g.dependentId))
    db.notificationPreferences = db.notificationPreferences.filter((p) => p.userId !== userId)
    db.exports = db.exports.filter((e) => e.userId !== userId)
    db.members = db.members.filter((m) => !ids.has(m.id))
    // Família em que era o único membro deixa de existir (R2).
    const emptied = new Set(mine.map((m) => m.familyId).filter((id) => !db.members.some((m) => m.familyId === id)))
    db.families = db.families.filter((f) => !emptied.has(f.id))
    db.users = db.users.filter((u) => u.id !== userId)
  })
}
