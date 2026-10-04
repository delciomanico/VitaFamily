import * as home from '@/mocks/handlers/home'

/** Resumos e relatórios (UC-RPT). Hoje mock; depois /api/v1/families/{id}/reports/*. */
export const reportService = {
  getHomeSummary: home.getHomeSummary,
}
