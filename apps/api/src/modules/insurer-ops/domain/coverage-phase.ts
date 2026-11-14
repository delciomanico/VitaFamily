// Projeção PURA dos pedidos de autorização de um processo no facto de cobertura que `processes` consome (state-machines.md,
// Process, tabela 3; BR-PRC-03/04; TC-PRC-26). Sem imports fora de `domain/` (TC-AUT-19). `processes` define a forma do facto
// (`CoverageFact`); esta forma é estruturalmente igual e a ligação verifica-se em compilação em `main/api.ts`.
import type { AuthorizationStatus } from "./authorization-machine.js";

export type CoveragePhase = "PENDING_DECISION" | "NEEDS_INFO" | "NOT_APPROVED" | "APPROVED" | "CLOSED";

export interface CoverageFact {
  phase: CoveragePhase;
  /** Só em `PENDING_DECISION`: o menor `decisionDueAt` dos pedidos pendentes. */
  dueAt?: Date;
  changedAt: Date;
}

export interface RequestForPhase {
  id: string;
  parentRequestId: string | null;
  status: AuthorizationStatus;
  decisionDueAt: Date;
  updatedAt: Date;
}

/** Prioridade na agregação (state-machines.md): o primeiro da lista ganha. */
const PRIORITY: readonly CoveragePhase[] = ["NEEDS_INFO", "NOT_APPROVED", "PENDING_DECISION", "APPROVED", "CLOSED"];

/** Fase de um pedido isolado (os cancelados já foram ignorados; um recusado com recurso vivo também). */
function phaseOfRequest(status: AuthorizationStatus): CoveragePhase {
  switch (status) {
    case "SUBMITTED":
    case "IN_REVIEW":
      return "PENDING_DECISION";
    case "INFO_REQUESTED":
      return "NEEDS_INFO";
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "NOT_APPROVED";
    case "CANCELLED":
      return "CLOSED";
  }
}

/** `undefined` = o processo não tem pedidos (sem facto). */
export function projectCoverage(requests: readonly RequestForPhase[]): CoverageFact | undefined {
  if (requests.length === 0) return undefined;
  const changedAt = new Date(Math.max(...requests.map((r) => r.updatedAt.getTime())));
  const alive = requests.filter((r) => r.status !== "CANCELLED");
  if (alive.length === 0) return { phase: "CLOSED", changedAt };
  // Um recusado com recurso não cancelado deixa de contar: conta o recurso.
  const appealed = new Set(alive.flatMap((r) => (r.parentRequestId === null ? [] : [r.parentRequestId])));
  const counted = alive.filter((r) => !(r.status === "REJECTED" && appealed.has(r.id)));
  const phases = new Set(counted.map((r) => phaseOfRequest(r.status)));
  const phase = PRIORITY.find((candidate) => phases.has(candidate)) ?? "CLOSED";
  const pendingDue = counted.filter((r) => phaseOfRequest(r.status) === "PENDING_DECISION").map((r) => r.decisionDueAt.getTime());
  return phase === "PENDING_DECISION" ? { phase, dueAt: new Date(Math.min(...pendingDue)), changedAt } : { phase, changedAt };
}
