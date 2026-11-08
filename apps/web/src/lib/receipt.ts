import type { ReceiptPaymentMethod, ReceiptStatus } from '@/types/clinicReceipt'

/** Cêntimos → texto com a moeda (ex.: “15 000,00 Kz”); sem conversão entre moedas (BR-CLN-34). */
export function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

/** Número de recibo na apresentação `R-000123`. */
export const receiptNumber = (number: number) => `R-${String(number).padStart(6, '0')}`

export const paymentMethodLabel: Record<ReceiptPaymentMethod, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  TRANSFER: 'Transferência',
  INSURANCE: 'Seguro',
}

export const receiptStatusLabel: Record<ReceiptStatus, string> = {
  ISSUED: 'Emitido',
  VOIDED: 'Anulado',
}

/** Ações da auditoria da clínica em português simples (BR-CLN-40); as desconhecidas aparecem tal como vêm. */
const auditActions: Record<string, string> = {
  CLINIC_ACCOUNT_LOGIN: 'Entrou no portal',
  CLINIC_STAFF_CREATE: 'Criou uma conta da equipa',
  CLINIC_STAFF_REMOVE: 'Removeu uma conta da equipa',
  CLINIC_RECEIPT_ISSUE: 'Emitiu um recibo',
  CLINIC_RECEIPT_VOID: 'Anulou um recibo',
  CLINIC_PROFILE_UPDATE: 'Atualizou o perfil da clínica',
  CLINIC_COMPLETE: 'Concluiu uma consulta',
  CLINIC_CANCEL: 'Cancelou uma consulta',
  CLINIC_WALKIN_BOOK: 'Marcou uma consulta presencial',
  CLINIC_VISIT_BOOK: 'Marcou uma visita presencial',
  CLINIC_PATIENT_CREATE: 'Criou um paciente',
  CLINIC_PATIENT_LINK: 'Ligou um paciente Vita',
  EXAM_CLINIC_COMPLETE: 'Emitiu resultados de um exame',
  EXAM_CLINIC_CANCEL: 'Cancelou um exame',
  CONSULT_REPORT_SAVED: 'Guardou um relatório de consulta',
  CONSULT_REPORT_FINALIZED: 'Finalizou um relatório de consulta',
  CONSULT_REPORT_AMENDED: 'Acrescentou uma adenda a um relatório',
  CONSULT_REPORT_VIEWED: 'Consultou um relatório de consulta',
  EXAM_RESULTS_DRAFT_SAVED: 'Guardou um rascunho de resultados',
  EXAM_RESULTS_DRAFT_DISCARDED: 'Descartou um rascunho de resultados',
  EXAM_REPORT_GENERATED: 'Gerou um laudo de exame',
  EXAM_REPORT_DOWNLOAD: 'Descarregou um laudo de exame',
}

export const auditActionLabel = (action: string) => auditActions[action] ?? action

/** Ações oferecidas no filtro da auditoria. */
export const auditActionOptions = Object.entries(auditActions).map(([value, label]) => ({ value, label }))

export const auditResultLabel = { SUCCESS: 'Concluída', DENIED: 'Recusada', FAILURE: 'Falhou' } as const
