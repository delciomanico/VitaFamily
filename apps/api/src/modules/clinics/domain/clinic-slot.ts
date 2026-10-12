// Entidade pura `ClinicSlot` (schema.md §3 v0.2, BR-CLN-04/UC-CLN-04). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export const CLINIC_SLOT_DURATIONS_MINUTES = [15, 20, 30, 45, 60] as const;
export type ClinicSlotDurationMinutes = (typeof CLINIC_SLOT_DURATIONS_MINUTES)[number];

export interface ClinicSlot {
  id: string;
  clinicId: string;
  specialty: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  createdAt: Date;
}

/** `ClinicSlotView` (openapi.yaml): estado calculado — ainda sem ligação a `appointments.slot_id`
 * (Fase D), por isso todo o horário publicado aqui é `FREE`. */
export type ClinicSlotState = "FREE" | "REQUESTED" | "SCHEDULED";

/** Nome da especialidade obrigatório, sem espaços nas pontas (mesmo critério de `assertValidClinicName`). */
export function assertValidSpecialty(specialty: string, field = "specialty"): string {
  const trimmed = specialty.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazia" }], { detail: "Especialidade inválida." });
  }
  return trimmed;
}

/** BR-CLN-04: só uma das durações permitidas (schema.md CHECK `duration_minutes`). */
export function assertValidDurationMinutes(value: number, field = "durationMinutes"): ClinicSlotDurationMinutes {
  if (!(CLINIC_SLOT_DURATIONS_MINUTES as readonly number[]).includes(value)) {
    throw new ValidationError([{ field, message: `tem de ser um de ${CLINIC_SLOT_DURATIONS_MINUTES.join(", ")}` }], {
      detail: "Duração inválida.",
    });
  }
  return value as ClinicSlotDurationMinutes;
}

/** BR-CLN-04: dois horários da mesma clínica são duplicados se coincidem em hora, especialidade e profissional. */
export function isDuplicateSlot(
  a: Pick<ClinicSlot, "startsAt" | "specialty" | "professionalName">,
  b: Pick<ClinicSlot, "startsAt" | "specialty" | "professionalName">,
): boolean {
  return a.startsAt.getTime() === b.startsAt.getTime() && a.specialty === b.specialty && (a.professionalName ?? null) === (b.professionalName ?? null);
}
