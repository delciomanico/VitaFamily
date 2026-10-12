// DataExport (entities.md; state-machines.md "DataExport": PENDING → READY | FAILED; READY → EXPIRED).
// Regras: no máximo 3 pedidos por dia (N7), pacote válido 7 dias (UC-ACC-06).
export type ExportStatus = "PENDING" | "READY" | "EXPIRED" | "FAILED";
export type ExportReason = "USER_REQUEST" | "LEAVE_FAMILY" | "REMOVED_BY_ADMIN";

export interface DataExport {
  id: string;
  requestedBy: string;
  familyId?: string;
  subjectMemberId?: string;
  reason: ExportReason;
  status: ExportStatus;
  storageKey?: string;
  expiresAt?: Date;
  createdAt: Date;
}

export const EXPORTS_PER_DAY = 3;
export const EXPORT_VALID_DAYS = 7;
/** Um pedido PENDING há mais tempo que isto perdeu-se (ex.: reinício do processo) → FAILED. */
export const EXPORT_PENDING_TIMEOUT_MS = 15 * 60_000;

const DAY_MS = 86_400_000;

export function exportExpiry(readyAt: Date): Date {
  return new Date(readyAt.getTime() + EXPORT_VALID_DAYS * DAY_MS);
}

/** Estado efetivo: READY passada a validade é EXPIRED; PENDING esquecido é FAILED. */
export function effectiveStatus(item: DataExport, now: Date): ExportStatus {
  if (item.status === "READY" && item.expiresAt && item.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (item.status === "PENDING" && now.getTime() - item.createdAt.getTime() > EXPORT_PENDING_TIMEOUT_MS) return "FAILED";
  return item.status;
}
