// Projeção estado do exame -> `phase` do facto publicado a `processes` (state-machines.md "Process", projeção 1,
// BR-PRC-04, TC-PRC-09). Função pura do módulo dono: `processes` só conhece a fase, nunca os estados internos.

/** Mesmos valores de `ProcessActPhase` do contrato (duplicado deliberadamente: nenhuma aresta entre módulos). */
export type ActPhase = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";

/** `REQUESTED`/`REJECTED` são obsoletos (ADR-023 revisto; a CHECK da BD proíbe-os): nunca ocorre, mas não rebenta a lista (BR-PRC-09). */
export class ActIntegrityError extends Error {
  constructor(status: string) {
    super(`Estado de exame sem fase de processo: ${status}`);
    this.name = "ActIntegrityError";
  }
}

export function projectActPhase(status: string): ActPhase {
  switch (status) {
    case "SCHEDULED":
      return "SCHEDULED";
    case "COMPLETED":
      return "DONE";
    case "CANCELLED":
      return "CANCELLED";
    default:
      throw new ActIntegrityError(status);
  }
}
