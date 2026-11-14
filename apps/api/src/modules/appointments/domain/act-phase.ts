// Projeção estado da consulta -> `phase` do facto publicado a `processes` (state-machines.md "Process", projeção 1,
// BR-PRC-04, TC-PRC-08). Função pura do módulo dono: `processes` só conhece a fase, nunca os estados internos.
import type { AppointmentStatus } from "./appointment.js";

/** Mesmos valores de `ProcessActPhase` do contrato (duplicado deliberadamente: nenhuma aresta entre módulos). */
export type ActPhase = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";

export interface ActPhaseInput {
  status: AppointmentStatus;
  arrivedAt?: Date | null;
  startedAt?: Date | null;
}

export function projectActPhase(input: ActPhaseInput): ActPhase {
  switch (input.status) {
    case "REQUESTED":
      return "PENDING";
    case "SCHEDULED":
      // Chegada ou início do atendimento (M14 Q): a consulta está a ser tratada.
      return input.arrivedAt || input.startedAt ? "IN_PROGRESS" : "SCHEDULED";
    case "COMPLETED":
      return "DONE";
    case "NO_SHOW":
      return "NO_SHOW";
    case "CANCELLED":
    case "REJECTED":
      return "CANCELLED";
  }
}
