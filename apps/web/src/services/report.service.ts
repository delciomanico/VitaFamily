import * as home from '@/mocks/handlers/home'
import * as api from '@/mocks/handlers/reports'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { todayISO } from '@/lib/date'
import type { Appointment } from '@/types/appointment'
import type { DoseStatus } from '@/types/medication'
import type { HomeSummary, ReportPeriod, TodayDose } from '@/types/report'
import { apiGetFamilyReport, apiGetMemberReport, apiListReportSubjects } from './memberViews'
import { apiListAlerts } from './alert.service'

/** Número máximo de alertas recentes enviados para a Home (a UI mostra os que couberem). */
const HOME_ALERTS_LIMIT = 8

interface ApiMember {
  id: string
  name: string
  isSelf: boolean
  status: 'ACTIVE' | 'BLOCKED'
}

interface ApiDose {
  id: string
  medicationName: string
  dosage: string
  scheduledAt: string
  status: DoseStatus
}

type ApiAppointment = Omit<Appointment, 'familyId'>

/** Sem permissão de leitura (403) ou sem partilha, o membro simplesmente não contribui para a Home. */
const orEmpty = <T>(request: Promise<{ items: T[] }>) => request.then((page) => page.items).catch(() => [] as T[])

/**
 * Resumo da Home (API real): compõe os dados de hoje a partir de `/members`, `/appointments`,
 * `/doses`, `/alerts` e `/report`. Cada membro só contribui com o que o servidor deixa ler.
 */
async function apiGetHomeSummary(familyId: string): Promise<HomeSummary> {
  const now = new Date()
  const members = (await apiFetch<ApiMember[]>(`/families/${familyId}/members`)).filter((m) => m.status === 'ACTIVE')
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000 - 1)
  const today = todayISO(now)

  const [perMember, alerts, report] = await Promise.all([
    Promise.all(
      members.map(async (member) => {
        const base = `/families/${familyId}/members/${member.id}`
        const [appointments, doses] = await Promise.all([
          orEmpty(
            apiFetch<{ items: ApiAppointment[] }>(
              `${base}/appointments?status=SCHEDULED&from=${encodeURIComponent(now.toISOString())}&limit=20`,
            ),
          ),
          orEmpty(
            apiFetch<{ items: ApiDose[] }>(
              `${base}/doses?from=${encodeURIComponent(startOfDay.toISOString())}&to=${encodeURIComponent(endOfDay.toISOString())}&limit=100`,
            ),
          ),
        ])
        return { member, appointments, doses }
      }),
    ),
    apiListAlerts(familyId).catch(() => []),
    apiFetch<{ members: Array<{ pending?: unknown[] }> }>(`/families/${familyId}/report`).catch(() => ({ members: [] })),
  ])

  const next = perMember
    .flatMap(({ member, appointments }) => appointments.map((a) => ({ a, member })))
    .sort((x, y) => x.a.scheduledAt.localeCompare(y.a.scheduledAt))[0]

  const todayDoses = perMember
    .flatMap(({ member, doses }) =>
      doses
        .filter((d) => todayISO(new Date(d.scheduledAt)) === today)
        .map((d): TodayDose => ({
          id: d.id,
          scheduledAt: d.scheduledAt,
          status: d.status,
          medication: `${d.medicationName} ${d.dosage}`.trim(),
          memberName: member.name,
          isSelf: member.isSelf,
        })),
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))

  return {
    nextAppointment: next
      ? {
          appointment: { ...next.a, familyId },
          memberName: next.member.name,
          isSelf: next.member.isSelf,
        }
      : null,
    today: {
      pendingDoses: todayDoses.filter((d) => d.status === 'PENDING').length,
      // TBD: o contrato (ExamResult) não tem data de registo, logo não há como contar resultados "novos".
      newResults: 0,
      members: members.length,
    },
    family: {
      tracked: report.members.length,
      withPending: report.members.filter((m) => (m.pending?.length ?? 0) > 0).length,
    },
    recentAlerts: alerts
      .sort((a, b) => b.triggerAt.localeCompare(a.triggerAt))
      .slice(0, HOME_ALERTS_LIMIT),
    todayDoses,
  }
}

/** Resumos e relatórios (UC-RPT). Home com `VITE_API_URL` usa a API real; relatórios via /report. */
export const reportService = {
  getHomeSummary: hasApiBackend() ? (familyId: string, _userId: string) => apiGetHomeSummary(familyId) : home.getHomeSummary,
  getFamilyReport: hasApiBackend()
    ? (familyId: string, _userId: string) => apiGetFamilyReport(familyId)
    : api.getFamilyReport,
  getMemberReport: hasApiBackend()
    ? (familyId: string, _userId: string, memberId: string, period?: Partial<ReportPeriod>) =>
        apiGetMemberReport(familyId, memberId, period)
    : api.getMemberReport,
  listReportSubjects: hasApiBackend()
    ? (familyId: string, _userId: string) => apiListReportSubjects(familyId)
    : api.listReportSubjects,
}
