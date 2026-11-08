import * as mock from '@/mocks/handlers/clinicReports'
import { apiFetch, apiFetchBlob, hasApiBackend } from '@/lib/apiClient'
import type { FamilyConsultationReport } from '@/types/clinicReport'

/**
 * Relatório da consulta do lado da família (M15 S, BR-CLN-45): só FINAL partilhado, para o titular
 * ou tutor. Sem estado "indisponível" na UI: quem não pode ler recebe NOT_FOUND/FORBIDDEN.
 */
const path = (familyId: string, memberId: string, appointmentId: string) =>
  `/families/${familyId}/members/${memberId}/appointments/${appointmentId}/report`

interface ApiFamilyReport extends Omit<FamilyConsultationReport, 'specialty' | 'reason' | 'findings' | 'impression' | 'plan'> {
  specialty?: string | null
  reason?: string | null
  findings?: string | null
  impression?: string | null
  plan?: string | null
}

const apiImpl = {
  get: async (familyId: string, _userId: string, memberId: string, appointmentId: string): Promise<FamilyConsultationReport> => {
    const r = await apiFetch<ApiFamilyReport>(path(familyId, memberId, appointmentId))
    return {
      ...r,
      specialty: r.specialty ?? undefined,
      reason: r.reason ?? undefined,
      findings: r.findings ?? undefined,
      impression: r.impression ?? undefined,
      plan: r.plan ?? undefined,
    }
  },
  pdf: (familyId: string, _userId: string, memberId: string, appointmentId: string) =>
    apiFetchBlob(`${path(familyId, memberId, appointmentId)}/pdf`),
}

const mockImpl: typeof apiImpl = {
  get: mock.getFamilyConsultationReport,
  pdf: mock.getFamilyConsultationReportPdf,
}

export const familyReportService = hasApiBackend() ? apiImpl : mockImpl
