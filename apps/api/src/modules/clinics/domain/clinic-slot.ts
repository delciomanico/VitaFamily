// Entidade pura `ClinicSlot` (schema.md §3 v0.2, BR-CLN-04/UC-CLN-04). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export const CLINIC_SLOT_DURATIONS_MINUTES = [15, 20, 30, 45, 60] as const;
export type ClinicSlotDurationMinutes = (typeof CLINIC_SLOT_DURATIONS_MINUTES)[number];

/** BR-APT-10 (D19): `APPOINTMENT` (default) ou `EXAM`; em `EXAM`, `specialty` é o tipo de exame. */
export const CLINIC_SLOT_KINDS = ["APPOINTMENT", "EXAM"] as const;
export type ClinicSlotKind = (typeof CLINIC_SLOT_KINDS)[number];

export interface ClinicSlot {
  id: string;
  clinicId: string;
  kind: ClinicSlotKind;
  specialty: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  /** BR-APT-11: vagas (1–50); sempre 1 em `APPOINTMENT`. */
  capacity: number;
  createdAt: Date;
}

/** `ClinicSlotView.state` (openapi.yaml, BR-APT-11): `APPOINTMENT` -> FREE|REQUESTED|SCHEDULED;
 * `EXAM` -> FREE|PARTIAL|FULL. */
export type ClinicSlotState = "FREE" | "REQUESTED" | "SCHEDULED" | "PARTIAL" | "FULL";

/** Marcações ativas de um horário, por estado (consultas `REQUESTED`/`SCHEDULED`; exames só `SCHEDULED`). */
export interface SlotBookingCounts {
  requested: number;
  scheduled: number;
}

export interface SlotOccupancy {
  bookedCount: number;
  remaining: number;
  state: ClinicSlotState;
}

export const CLINIC_SLOT_CAPACITY_MIN = 1;
export const CLINIC_SLOT_CAPACITY_MAX = 50;

/** BR-APT-11: ocupação calculada em consulta (sem coluna derivada, schema.md §3). */
export function computeSlotOccupancy(slot: Pick<ClinicSlot, "kind" | "capacity">, counts: SlotBookingCounts): SlotOccupancy {
  if (slot.kind === "EXAM") {
    const bookedCount = counts.scheduled;
    const remaining = Math.max(slot.capacity - bookedCount, 0);
    return { bookedCount, remaining, state: bookedCount === 0 ? "FREE" : remaining === 0 ? "FULL" : "PARTIAL" };
  }
  const bookedCount = counts.requested + counts.scheduled;
  const remaining = Math.max(slot.capacity - bookedCount, 0);
  return { bookedCount, remaining, state: counts.scheduled > 0 ? "SCHEDULED" : counts.requested > 0 ? "REQUESTED" : "FREE" };
}

/** BR-APT-11: `capacity` inteiro 1–50 (schema.md CHECK). */
export function assertValidCapacity(value: number | undefined | null, field = "capacity"): number {
  if (value === undefined || value === null) {
    return CLINIC_SLOT_CAPACITY_MIN;
  }
  if (!Number.isInteger(value) || value < CLINIC_SLOT_CAPACITY_MIN || value > CLINIC_SLOT_CAPACITY_MAX) {
    throw new ValidationError([{ field, message: `tem de ser um inteiro entre ${String(CLINIC_SLOT_CAPACITY_MIN)} e ${String(CLINIC_SLOT_CAPACITY_MAX)}` }], {
      detail: "Número de vagas inválido.",
    });
  }
  return value;
}

/** BR-APT-11: só `kind=EXAM` pode ter mais de uma vaga. */
export function assertCapacityAllowedForKind(kind: ClinicSlotKind, capacity: number, field = "capacity"): void {
  if (kind !== "EXAM" && capacity !== 1) {
    throw new ValidationError([{ field, message: "só horários de exame podem ter mais de uma vaga" }], { detail: "Número de vagas inválido para consulta." });
  }
}

/** Nome da especialidade obrigatório, sem espaços nas pontas (mesmo critério de `assertValidClinicName`). */
export function assertValidSpecialty(specialty: string, field = "specialty"): string {
  const trimmed = specialty.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazia" }], { detail: "Especialidade inválida." });
  }
  return trimmed;
}

/** BR-APT-10: ausente = `APPOINTMENT`; qualquer outro valor é `VALIDATION_ERROR`. */
export function assertValidSlotKind(value: string | undefined | null, field = "kind"): ClinicSlotKind {
  if (value === undefined || value === null) {
    return "APPOINTMENT";
  }
  if (!(CLINIC_SLOT_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError([{ field, message: "tem de ser APPOINTMENT ou EXAM" }], { detail: "Tipo de horário inválido." });
  }
  return value as ClinicSlotKind;
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
  a: Pick<ClinicSlot, "startsAt" | "specialty" | "professionalName" | "kind">,
  b: Pick<ClinicSlot, "startsAt" | "specialty" | "professionalName" | "kind">,
): boolean {
  return a.startsAt.getTime() === b.startsAt.getTime() && a.kind === b.kind && a.specialty === b.specialty && (a.professionalName ?? null) === (b.professionalName ?? null);
}
