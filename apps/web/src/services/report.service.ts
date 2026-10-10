import * as home from '@/mocks/handlers/home'
import * as api from '@/mocks/handlers/reports'

/** Resumos e relatórios (UC-RPT). Hoje mock; depois /api/v1/families/{id}/report e …/members/{id}/report. */
export const reportService = {
  getHomeSummary: home.getHomeSummary,
  getFamilyReport: api.getFamilyReport,
  getMemberReport: api.getMemberReport,
  listReportSubjects: api.listReportSubjects,
}
