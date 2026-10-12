// Entidade pura `Appointment` (entities.md, categoria C5) e regras simples (BR-APT-01/02,
// state-machines.md "Appointment", ST4; D17: REQUESTED/REJECTED do portal da clínica parceira).
// Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";

export type AppointmentStatus = "REQUESTED" | "SCHEDULED" | "REJECTED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export interface Appointment {
  id: string;
  familyId: string;
  memberId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
  professionalName?: string;
  clinicId?: string;
  clinicName?: string;
  /** Especialidade (texto livre; ex.: "Cardiologia"). */
  specialty?: string;
  reason?: string;
  notes?: string;
  outcomeRequestedAt?: Date;
  /** Horário de clínica parceira de origem (D17) — só preenchido quando `status` nasceu `REQUESTED`. */
  slotId?: string;
  /** Motivo da clínica ao recusar o pedido ou cancelar a consulta confirmada (D17). */
  responseNote?: string;
  /** Resultado da consulta registado pela própria clínica (D18, BR-CLN-06); nunca escrito pela
   * família — distinto de `notes`. */
  clinicOutcomeNote?: string;
  outcomeRecordedByClinicAccountId?: string;
  outcomeRecordedAt?: Date;
  createdAt: Date;
}

const ALLOWED_APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  // D17: o Gestor da clínica confirma/recusa; o titular/tutor desiste (REQUESTED -> CANCELLED,
  // também usada pelo sistema quando a hora do horário passa sem resposta, BR-APT-08).
  REQUESTED: ["SCHEDULED", "REJECTED", "CANCELLED"],
  SCHEDULED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  CANCELLED: ["SCHEDULED"],
  // ST4: correção entre os dois desfechos, nos dois sentidos.
  COMPLETED: ["NO_SHOW"],
  NO_SHOW: ["COMPLETED"],
  // D17: estado final — um pedido recusado não reabre (BR-APT-06: o horário volta a ficar livre;
  // pedir de novo cria um `Appointment` novo).
  REJECTED: [],
};

/** state-machines.md "Appointment"/ST4/D17: transições permitidas; idêntico ao atual é sempre idempotente. */
export function assertValidAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_APPOINTMENT_TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado da consulta não permitida." });
  }
}

/**
 * UC-APT-01/UC-APT-07 (D17): `REQUESTED` só nasce de um horário de clínica parceira (`hasSlotId`);
 * sem horário, só `SCHEDULED`/`COMPLETED` são estados de criação válidos (AppointmentInput — a
 * família nunca escolhe `REQUESTED`/`REJECTED` diretamente).
 */
export function assertValidCreationStatus(status: AppointmentStatus, hasSlotId: boolean): void {
  if (hasSlotId) {
    if (status !== "REQUESTED") {
      throw new ValidationError([{ field: "status", message: "nasce sempre REQUESTED com slotId" }], { detail: "Estado inicial inválido para marcação em clínica parceira." });
    }
    return;
  }
  if (status !== "SCHEDULED" && status !== "COMPLETED") {
    throw new ValidationError([{ field: "status", message: "só SCHEDULED ou COMPLETED" }], { detail: "Estado inicial inválido." });
  }
}
