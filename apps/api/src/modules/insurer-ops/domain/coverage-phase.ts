// Projeção PURA dos pedidos de autorização de um processo no facto de cobertura que `processes` consome (state-machines.md,
// Process, tabela 3; BR-PRC-03/04; TC-PRC-26). Sem imports fora de `domain/` (TC-AUT-19). `processes` define a forma do facto
// (`CoverageFact`); esta forma é estruturalmente igual e a ligação verifica-se em compilação em `main/api.ts`.
import type { AuthorizationStatus } from "./authorization-machine.js";
import { isExpired } from "./deadline.js";

/** Fatia 5 (ADR-036): `EXPIRED` (aprovação com `validUntil` passada) e `WITHDRAWN` (aprovação revertida pela seguradora). */
export type CoveragePhase = "PENDING_DECISION" | "NEEDS_INFO" | "NOT_APPROVED" | "APPROVED" | "WITHDRAWN" | "EXPIRED" | "CLOSED";

export interface CoverageFact {
  phase: CoveragePhase;
  /** Só em `PENDING_DECISION`: o menor `decisionDueAt` dos pedidos pendentes. */
  dueAt?: Date;
  /** Fim de validade, só em `APPROVED` e `EXPIRED` (do pedido determinante). */
  validUntil?: Date;
  /** O pedido determinante é um recurso (BR-PRC-12: a família só vê «nova análise»). */
  appeal: boolean;
  /** Só em `APPROVED`: aprovação em parte (valor autorizado < pedido). Booleano, sem valores. */
  partial: boolean;
  changedAt: Date;
}

export interface RequestForPhase {
  id: string;
  parentRequestId: string | null;
  status: AuthorizationStatus;
  /** Só `CANCELLED`: `ANALYST_CANCELLED` = aprovação revertida (`WITHDRAWN`); os restantes motivos ignoram-se (BR-PRC-14). */
  closedReason: "INFO_TIMEOUT" | "CLINIC_CANCELLED" | "ANALYST_CANCELLED" | null;
  decisionDueAt: Date;
  /** Fatia 4 (BR-AUT-07): uma aprovação com `validUntil` passada projeta-se como `EXPIRED` (derivada, sem estado nem job). */
  validUntil: Date | null;
  requestedAmount: number;
  authorizedAmount: number | null;
  updatedAt: Date;
}

/** Prioridade na agregação (state-machines.md; BR-PRC-14): o primeiro da lista ganha. */
const PRIORITY: readonly CoveragePhase[] = ["NEEDS_INFO", "NOT_APPROVED", "PENDING_DECISION", "APPROVED", "WITHDRAWN", "EXPIRED", "CLOSED"];

/** Fase de um pedido isolado (os cancelados por clínica/prazo já foram ignorados; um recusado com recurso vivo também). */
function phaseOfRequest(request: Pick<RequestForPhase, "status" | "validUntil" | "closedReason">, now: Date): CoveragePhase {
  switch (request.status) {
    case "SUBMITTED":
    case "IN_REVIEW":
      return "PENDING_DECISION";
    case "INFO_REQUESTED":
      return "NEEDS_INFO";
    case "APPROVED":
      return isExpired(request.validUntil, now) ? "EXPIRED" : "APPROVED";
    case "REJECTED":
      return "NOT_APPROVED";
    case "CANCELLED":
      return request.closedReason === "ANALYST_CANCELLED" ? "WITHDRAWN" : "CLOSED";
  }
}

/** Pedido que determina o estado: o pendente com o prazo mais próximo; nos restantes, o mais recentemente alterado. */
function determinant(requests: readonly RequestForPhase[], phase: CoveragePhase): RequestForPhase | undefined {
  const byDue = (a: RequestForPhase, b: RequestForPhase) => a.decisionDueAt.getTime() - b.decisionDueAt.getTime();
  const byRecent = (a: RequestForPhase, b: RequestForPhase) => b.updatedAt.getTime() - a.updatedAt.getTime();
  return [...requests].sort((a, b) => (phase === "PENDING_DECISION" ? byDue(a, b) : byRecent(a, b)) || a.id.localeCompare(b.id))[0];
}

/** `undefined` = o processo não tem pedidos (sem facto). */
export function projectCoverage(requests: readonly RequestForPhase[], now: Date): CoverageFact | undefined {
  if (requests.length === 0) return undefined;
  const changedAt = new Date(Math.max(...requests.map((r) => r.updatedAt.getTime())));
  // CLINIC_CANCELLED e INFO_TIMEOUT continuam ignorados; ANALYST_CANCELLED passa a contar (`WITHDRAWN`).
  const alive = requests.filter((r) => r.status !== "CANCELLED");
  const withdrawn = requests.filter((r) => r.status === "CANCELLED" && r.closedReason === "ANALYST_CANCELLED");
  if (alive.length + withdrawn.length === 0) return { phase: "CLOSED", appeal: false, partial: false, changedAt };
  // Um recusado com recurso não cancelado deixa de contar: conta o recurso.
  const appealed = new Set(alive.flatMap((r) => (r.parentRequestId === null ? [] : [r.parentRequestId])));
  const counted = [...alive.filter((r) => !(r.status === "REJECTED" && appealed.has(r.id))), ...withdrawn];
  const phases = new Set(counted.map((r) => phaseOfRequest(r, now)));
  const phase = PRIORITY.find((candidate) => phases.has(candidate)) ?? "CLOSED";
  const winner = determinant(
    counted.filter((r) => phaseOfRequest(r, now) === phase),
    phase,
  );
  const appeal = winner !== undefined && winner.parentRequestId !== null;
  const partial = phase === "APPROVED" && winner?.authorizedAmount != null && winner.authorizedAmount < winner.requestedAmount;
  return {
    phase,
    ...(phase === "PENDING_DECISION" && winner ? { dueAt: winner.decisionDueAt } : {}),
    ...((phase === "APPROVED" || phase === "EXPIRED") && winner?.validUntil ? { validUntil: winner.validUntil } : {}),
    appeal,
    partial,
    changedAt,
  };
}
