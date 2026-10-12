import { apiFetch } from '@/lib/apiClient'
import { monthsBefore, todayISO } from '@/lib/date'
import { nextDoseAt } from '@/lib/medication'
import type { MemberHistory } from '@/mocks/handlers/members'
import type { Appointment, AppointmentItem } from '@/types/appointment'
import type {
  Family,
  FamilyMemberCard,
  FamilyOverview,
  FamilyRole,
  PublicMember,
} from '@/types/family'
import type { BloodType, MedicalCondition } from '@/types/health'
import type { HistoryEntry } from '@/types/history'
import type { MemberProfile } from '@/types/member'
import type { MedicationSummary } from '@/types/medication'
import type {
  AdherenceItem,
  FamilyReport,
  FamilyReportMember,
  MemberReport,
  PendingItem,
  ReportPeriod,
  ReportSubject,
} from '@/types/report'
import type { SharedWithMeItem, SharingRule, SharingSettings } from '@/types/settings'
import { SHARING_CATEGORIES, type SharingCategory } from '@/types/sharing'
import { toAppointment, type ApiAppointment } from './appointment.service'
import { toExamination, type ApiExamination } from './examination.service'
import { fromApiBloodType, type ApiAllergy, type ApiCondition } from './health.service'
import { toPlan, type ApiPlan } from './medication.service'
import { toPrescription, type ApiPrescription } from './prescription.service'

/*
 * Vistas agregadas por membro (perfil, histórico, relatórios, partilha) sobre a API real.
 * O que cada utilizador pode ver vem do servidor: o próprio e os dependentes de que é tutor
 * (BR-MEM-08) veem tudo; dos outros só as categorias de `shared-with-me`. As secções sem
 * permissão são omitidas pelo servidor nos relatórios (BR-RPT-01).
 */

interface ApiFullMember {
  id: string
  familyId: string
  name: string
  birthDate: string
  isDependent: boolean
  hasAccount: boolean
  role: FamilyRole | null
  status: 'ACTIVE' | 'BLOCKED'
  isSelf: boolean
  guardianIds: string[]
}

interface Subject {
  member: ApiFullMember
  isSelf: boolean
  manage: boolean
  categories: SharingCategory[]
}

interface ApiPending {
  type: PendingItem['type']
  sourceId: string
  date: string
}

interface ApiFamilyReportMember {
  member: ApiFullMember
  allergies?: ApiAllergy[]
  conditions?: ApiCondition[]
  activeMedications?: ApiPlan[]
  upcomingAppointments?: ApiAppointment[]
  upcomingExaminations?: ApiExamination[]
  pending?: ApiPending[]
}

interface ApiMemberReport {
  generatedAt: string
  from: string
  to: string
  member: ApiFullMember
  bloodType?: string | null
  allergies?: ApiAllergy[]
  conditions?: ApiCondition[]
  prescriptions?: ApiPrescription[]
  medicationPlans?: ApiPlan[]
  adherence?: AdherenceItem[]
  appointments?: ApiAppointment[]
  examinations?: ApiExamination[]
}

const ALL_CATEGORIES: SharingCategory[] = [...SHARING_CATEGORIES]

const toPublic = (m: ApiFullMember): PublicMember => ({
  id: m.id,
  name: m.name,
  birthDate: m.birthDate,
  role: m.role ?? undefined,
  isDependent: m.isDependent,
  hasAccount: m.hasAccount,
})

async function loadSubjects(familyId: string): Promise<{ self: ApiFullMember; subjects: Subject[] }> {
  const [members, shared] = await Promise.all([
    apiFetch<ApiFullMember[]>(`/families/${familyId}/members`),
    apiFetch<SharedWithMeItem[]>(`/families/${familyId}/shared-with-me`).catch(() => [] as SharedWithMeItem[]),
  ])
  const self = members.find((m) => m.isSelf)
  if (!self) throw new Error('missing-self-member')
  const sharedBy = new Map(shared.map((s) => [s.memberId, s.categories]))
  const subjects = members
    .filter((m) => m.status === 'ACTIVE')
    .map((member): Subject => {
      const manage = member.isSelf || member.guardianIds.includes(self.id)
      const granted = (sharedBy.get(member.id) ?? []).filter((c): c is SharingCategory =>
        (SHARING_CATEGORIES as readonly string[]).includes(c),
      )
      return { member, isSelf: member.isSelf, manage, categories: manage ? ALL_CATEGORIES : granted }
    })
    // O próprio primeiro, depois os que gere, depois os restantes.
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(b.manage) - Number(a.manage))
  return { self, subjects }
}

function subjectOf(subjects: Subject[], memberId: string): Subject {
  const found = subjects.find((s) => s.member.id === memberId)
  if (!found) throw new Error('NOT_FOUND')
  return found
}

function summarize(familyId: string, plan: ApiPlan, memberName: string, now: Date): MedicationSummary {
  const mapped = toPlan(familyId, plan)
  const next = nextDoseAt(mapped, now)
  return { plan: mapped, memberName, nextDoseAt: next, remindersOn: next !== null }
}

const names = (items?: Array<{ name: string }>) => items?.map((i) => i.name)

function toCondition(familyId: string, memberId: string, c: ApiCondition): MedicalCondition {
  return {
    id: c.id,
    familyId,
    memberId,
    name: c.name,
    kind: c.kind,
    notes: c.notes ?? undefined,
    since: c.since ?? undefined,
    until: c.until ?? undefined,
  }
}

/** Próximas primeiro (por data), depois as passadas (mais recentes primeiro). */
const upcomingFirst = (now: Date) => (a: Appointment, b: Appointment) => {
  const aFuture = Date.parse(a.scheduledAt) > now.getTime()
  const bFuture = Date.parse(b.scheduledAt) > now.getTime()
  if (aFuture !== bFuture) return aFuture ? -1 : 1
  return aFuture ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt)
}

function pendingOf(memberId: string, memberName: string, pending: ApiPending[] | undefined): PendingItem[] {
  // TBD: o contrato só dá tipo, origem e data; o rótulo mostra o membro e o link usa a origem.
  return (pending ?? []).map((p) => ({ ...p, memberId, label: memberName, targetId: p.sourceId }))
}

const memberReportPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/report`

/** Minha família (UC-FAM-05). */
export async function apiGetFamilyOverview(familyId: string): Promise<FamilyOverview> {
  const [{ self, subjects }, family, report] = await Promise.all([
    loadSubjects(familyId),
    apiFetch<{ id: string; name: string }>(`/families/${familyId}`),
    apiFetch<{ members: ApiFamilyReportMember[] }>(`/families/${familyId}/report`).catch(() => ({ members: [] })),
  ])
  const pendingCount = new Map(report.members.map((m) => [m.member.id, m.pending?.length ?? 0]))
  const members = subjects.map(
    ({ member, isSelf, manage, categories }): FamilyMemberCard => {
      const count = pendingCount.get(member.id) ?? 0
      return {
        member: toPublic(member),
        isSelf,
        manage,
        tracking: manage
          ? count > 0
            ? { kind: 'PENDING', count }
            : { kind: 'UP_TO_DATE' }
          : { kind: 'SHARED', categories },
      }
    },
  )
  const fam: Family = { id: family.id, name: family.name, createdBy: '' }
  return { family: fam, isAdmin: self.role === 'FAMILY_ADMIN', members }
}

/** Quantos itens recentes cada secção de “Atividade” mostra no perfil do membro. */
const PROFILE_ACTIVITY_LIMIT = 3

/** Perfil do membro (UC-PRV-02), a partir do relatório individual (que já omite o que não posso ver). */
export async function apiGetMemberProfile(familyId: string, memberId: string): Promise<MemberProfile> {
  const now = new Date()
  const { self, subjects } = await loadSubjects(familyId)
  const subject = subjectOf(subjects, memberId)
  const { member, manage, categories } = subject
  const report = await apiFetch<ApiMemberReport>(memberReportPath(familyId, memberId)).catch(() => null)
  const can = (category: SharingCategory) => categories.includes(category)
  const recent = <T>(items: T[]) => items.slice(0, PROFILE_ACTIVITY_LIMIT)

  const appointments = report?.appointments
    ?.map((a) => toAppointment(familyId, a))
    .filter((a) => ['SCHEDULED', 'COMPLETED', 'NO_SHOW'].includes(a.status))
    .sort(upcomingFirst(now))

  return {
    member: toPublic(member),
    isSelf: subject.isSelf,
    manage,
    // BR-MEM-16: o Admin também remove adultos com conta (o backend gera o pacote e avisa por
    // e-mail antes de apagar); LAST_ADMIN/LAST_GUARDIAN ficam a cargo do erro devolvido pela API.
    canRemove: self.role === 'FAMILY_ADMIN' && !subject.isSelf,
    guardians: subjects.filter((s) => member.guardianIds.includes(s.member.id)).map((s) => s.member.name),
    access: categories,
    bloodType: can('ALLERGIES') && report?.bloodType ? fromApiBloodType(report.bloodType) : undefined,
    allergies: can('ALLERGIES') ? names(report?.allergies) : undefined,
    conditions: can('CONDITIONS') ? names(report?.conditions?.filter((c) => c.kind === 'CONDITION')) : undefined,
    medications: can('MEDICATION')
      ? report?.medicationPlans
          ?.filter((p) => p.status === 'ACTIVE')
          .map((p) => summarize(familyId, p, member.name, now))
      : undefined,
    appointments: can('APPOINTMENTS')
      ? appointments && recent(appointments).map((appointment) => ({ appointment, memberName: member.name }))
      : undefined,
    examinations: can('EXAMS')
      ? report?.examinations &&
        recent([...report.examinations].sort((a, b) => b.examDate.localeCompare(a.examDate))).map((e) => ({
          examination: toExamination(familyId, e),
          memberName: member.name,
          resultCount: e.results.length,
        }))
      : undefined,
    prescriptions: can('MEDICATION')
      ? report?.prescriptions &&
        recent([...report.prescriptions].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))).map((p) => ({
          prescription: toPrescription(familyId, p),
          memberName: member.name,
          medicationCount: p.medications.length,
        }))
      : undefined,
  }
}

/** Histórico médico do membro: relatório dos últimos 5 anos (o máximo permitido, BR-RPT-02). */
export async function apiGetMemberHistory(familyId: string, memberId: string): Promise<MemberHistory> {
  const now = new Date()
  const { subjects } = await loadSubjects(familyId)
  const { member, manage, categories } = subjectOf(subjects, memberId)
  const to = todayISO(now)
  const report = await apiFetch<ApiMemberReport>(
    `${memberReportPath(familyId, memberId)}?from=${monthsBefore(to, 60)}&to=${to}`,
  ).catch(() => null)
  const today = todayISO(now)
  const happened = ['SCHEDULED', 'COMPLETED', 'NO_SHOW']

  const entries: HistoryEntry[] = [
    ...(report?.appointments ?? [])
      .filter((a) => happened.includes(a.status) && Date.parse(a.scheduledAt) <= now.getTime())
      .map((a): HistoryEntry => ({
        id: a.id,
        kind: 'APPOINTMENT',
        title: a.reason ?? 'Consulta',
        subtitle: a.clinicName ?? undefined,
        date: a.scheduledAt,
      })),
    ...(report?.examinations ?? [])
      .filter((e) => e.examDate <= today)
      .map((e): HistoryEntry => ({
        id: e.id,
        kind: 'EXAMINATION',
        title: e.name,
        subtitle: e.clinicName ?? undefined,
        date: e.examDate,
      })),
    ...(report?.prescriptions ?? []).map((p): HistoryEntry => ({
      id: p.id,
      kind: 'PRESCRIPTION',
      title: 'Receita',
      subtitle: p.doctorName ?? undefined,
      date: p.issuedOn,
    })),
    ...(report?.conditions ?? [])
      .filter((c) => c.kind === 'HISTORY' && c.since)
      .map((c): HistoryEntry => ({
        id: c.id,
        kind: 'HISTORY',
        title: c.name,
        subtitle: c.notes ?? undefined,
        date: c.since ?? '',
      })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const historyCategories: SharingCategory[] = ['APPOINTMENTS', 'EXAMS', 'MEDICATION', 'CONDITIONS']
  return {
    member: toPublic(member),
    manage,
    entries,
    hidden: historyCategories.filter((c) => !categories.includes(c)),
  }
}

/** Quem se pode escolher no relatório individual. */
export async function apiListReportSubjects(familyId: string): Promise<ReportSubject[]> {
  const { subjects } = await loadSubjects(familyId)
  return subjects
    .filter((s) => s.manage || s.categories.length > 0)
    .map((s) => ({ member: toPublic(s.member), isSelf: s.isSelf }))
}

/** Visão familiar (UC-RPT-02). */
export async function apiGetFamilyReport(familyId: string): Promise<FamilyReport> {
  const now = new Date()
  const [{ subjects }, family, report] = await Promise.all([
    loadSubjects(familyId),
    apiFetch<{ id: string; name: string }>(`/families/${familyId}`),
    apiFetch<{ generatedAt: string; members: ApiFamilyReportMember[] }>(`/families/${familyId}/report`),
  ])
  const byId = new Map(report.members.map((m) => [m.member.id, m]))
  const members = subjects
    .filter((s) => s.manage || s.categories.length > 0)
    .map((s): FamilyReportMember => {
      const r = byId.get(s.member.id)
      const name = s.member.name
      return {
        member: toPublic(s.member),
        isSelf: s.isSelf,
        manage: s.manage,
        categories: s.categories,
        allergies: names(r?.allergies),
        conditions: names(r?.conditions),
        activeMedications: r?.activeMedications?.map((p) => summarize(familyId, p, name, now)),
        upcomingAppointments: r?.upcomingAppointments?.map(
          (a): AppointmentItem => ({ appointment: toAppointment(familyId, a), memberName: name }),
        ),
        upcomingExaminations: r?.upcomingExaminations?.map((e) => ({
          examination: toExamination(familyId, e),
          memberName: name,
          resultCount: e.results.length,
        })),
        pending: pendingOf(s.member.id, name, r?.pending),
      }
    })
  return {
    generatedAt: report.generatedAt,
    family: { id: family.id, name: family.name, createdBy: '' },
    familySize: subjects.length,
    members,
  }
}

/** Relatório individual (UC-RPT-01). O período, por defeito e máximo, é validado pelo servidor. */
export async function apiGetMemberReport(
  familyId: string,
  memberId: string,
  period: Partial<ReportPeriod> = {},
): Promise<MemberReport> {
  const now = new Date()
  const { subjects } = await loadSubjects(familyId)
  const { member, isSelf, manage, categories } = subjectOf(subjects, memberId)
  const query = new URLSearchParams()
  if (period.from) query.set('from', period.from)
  if (period.to) query.set('to', period.to)
  const suffix = query.size ? `?${query}` : ''
  const [report, family] = await Promise.all([
    apiFetch<ApiMemberReport>(`${memberReportPath(familyId, memberId)}${suffix}`),
    apiFetch<{ members: ApiFamilyReportMember[] }>(`/families/${familyId}/report`).catch(() => ({ members: [] })),
  ])
  const can = (category: SharingCategory) => categories.includes(category)
  const name = member.name
  const plans = report.medicationPlans ?? []
  const pending = family.members.find((m) => m.member.id === memberId)?.pending

  return {
    generatedAt: report.generatedAt,
    from: report.from,
    to: report.to,
    member: toPublic(member),
    isSelf,
    manage,
    categories,
    bloodType:
      can('ALLERGIES') && report.bloodType ? (fromApiBloodType(report.bloodType) as BloodType | undefined) : undefined,
    allergies: can('ALLERGIES') ? names(report.allergies) : undefined,
    conditions: can('CONDITIONS') ? report.conditions?.map((c) => toCondition(familyId, memberId, c)) : undefined,
    prescriptions: can('MEDICATION')
      ? report.prescriptions?.map((p) => ({
          prescription: toPrescription(familyId, p),
          memberName: name,
          medicationCount: p.medications.length,
        }))
      : undefined,
    medications: can('MEDICATION')
      ? plans.filter((p) => p.status === 'ACTIVE').map((p) => summarize(familyId, p, name, now))
      : undefined,
    adherence: can('MEDICATION') ? report.adherence : undefined,
    appointments: can('APPOINTMENTS')
      ? report.appointments
          ?.map((a) => toAppointment(familyId, a))
          .sort(upcomingFirst(now))
          .map((appointment) => ({ appointment, memberName: name }))
      : undefined,
    examinations: can('EXAMS')
      ? report.examinations?.map((e) => ({
          examination: toExamination(familyId, e),
          memberName: name,
          resultCount: e.results.length,
        }))
      : undefined,
    pending: pendingOf(memberId, name, pending),
  }
}

/** Partilha de um membro por categoria (UC-PRV-01). */
export async function apiGetSharing(familyId: string, memberId: string): Promise<SharingSettings> {
  const [{ subjects }, settings] = await Promise.all([
    loadSubjects(familyId),
    apiFetch<{ grants: Array<{ category: SharingCategory; granteeMemberId?: string | null }> }>(
      `/families/${familyId}/members/${memberId}/sharing`,
    ),
  ])
  const { member } = subjectOf(subjects, memberId)
  // Podem receber: membros ativos com conta, exceto o próprio e os seus tutores (já veem tudo).
  const others = subjects
    .map((s) => s.member)
    .filter((m) => m.hasAccount && m.id !== memberId && !member.guardianIds.includes(m.id))
    .map(toPublic)
  return {
    member: toPublic(member),
    grants: settings.grants.map(({ category, granteeMemberId }): SharingRule =>
      granteeMemberId ? { category, granteeMemberId } : { category },
    ),
    others,
  }
}

export async function apiPutSharing(familyId: string, memberId: string, grants: SharingRule[]): Promise<SharingSettings> {
  await apiFetch<unknown>(`/families/${familyId}/members/${memberId}/sharing`, { method: 'PUT', body: { grants } })
  return apiGetSharing(familyId, memberId)
}

export async function apiSharedWithMe(familyId: string): Promise<SharedWithMeItem[]> {
  const list = await apiFetch<Array<{ memberId: string; memberName: string; categories: string[] }>>(
    `/families/${familyId}/shared-with-me`,
  )
  return list.map((item) => ({
    ...item,
    categories: item.categories.filter((c): c is SharingCategory =>
      (SHARING_CATEGORIES as readonly string[]).includes(c),
    ),
  }))
}
