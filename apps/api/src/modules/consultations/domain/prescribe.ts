// Elegibilidade da receita digital (MK4, BR-MKT-79..80; state-machines.md «Receita digital»). Função pura: sem I/O nem relógio próprio.
// Qualquer método de consulta emite (OP-126): o método NÃO é critério.
import type { BookingStatus } from "./booking.js";

export const PRESCRIPTION_WINDOW_MS = 7 * 86_400_000;

export interface CanPrescribeFacts {
  /** `DIGITAL_PRESCRIPTION_ENABLED` (lida no arranque, injetada). */
  flagEnabled: boolean;
  professionalApproved: boolean;
  bookingStatus: BookingStatus;
  /** Categoria da especialidade marcada. */
  specialtyCategory: "HEALTH" | "WELLNESS";
  /** `completed_at` da marcação (`null` fora de `COMPLETED`). */
  completedAtMs: number | null;
  /** Já existe `Prescription` com `booking_id` = marcação. */
  prescriptionExists: boolean;
}

/** Verdadeiro **só** com todas as condições; `agora ≤ completedAt + 7 dias` (inclusive). */
export function canPrescribe(f: CanPrescribeFacts, nowMs: number): boolean {
  return (
    f.flagEnabled &&
    f.professionalApproved &&
    f.bookingStatus === "COMPLETED" &&
    f.specialtyCategory === "HEALTH" &&
    f.completedAtMs !== null &&
    nowMs <= f.completedAtMs + PRESCRIPTION_WINDOW_MS &&
    !f.prescriptionExists
  );
}
