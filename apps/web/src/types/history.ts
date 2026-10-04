/** Entrada do histórico médico de um membro (vista agregada, não é uma entidade). */
export type HistoryEntryKind = 'APPOINTMENT' | 'EXAMINATION' | 'PRESCRIPTION' | 'HISTORY'

export interface HistoryEntry {
  /** Id do recurso de origem. */
  id: string
  kind: HistoryEntryKind
  title: string
  subtitle?: string
  /** Data ISO ou instante ISO, usada para ordenar e agrupar por ano. */
  date: string
}
