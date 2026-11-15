// SLA medido, não decidido (BR-AUT-20, Q-V2 A): estado de cumprimento DERIVADO (nunca persistido) e percentagens das métricas.
// Puro: o relógio chega como argumento. Nunca há transição por decurso de prazo; só a marca `escalated_at` (job).
import type { AuthorizationStatus } from "./authorization-machine.js";

export type SlaStatus = "ON_TIME" | "OVERDUE" | "MET" | "MISSED";

export interface SlaSubject {
  status: AuthorizationStatus;
  decisionDueAt: Date;
  decidedAt: Date | null;
}

/** `IN_REVIEW` em prazo/atrasado; `APPROVED`/`REJECTED` decidido a tempo ou tarde; nos restantes estados não se aplica. */
export function slaStatus(subject: SlaSubject, now: Date): SlaStatus | null {
  if (subject.status === "IN_REVIEW") return isOverdue(subject, now) ? "OVERDUE" : "ON_TIME";
  if ((subject.status === "APPROVED" || subject.status === "REJECTED") && subject.decidedAt !== null) return subject.decidedAt.getTime() <= subject.decisionDueAt.getTime() ? "MET" : "MISSED";
  return null;
}

/** Em atraso = prazo atingido ou passado (a mesma comparação do job `insurer.flag-sla-breaches`). */
export function isOverdue(subject: Pick<SlaSubject, "decisionDueAt">, now: Date): boolean {
  return subject.decisionDueAt.getTime() <= now.getTime();
}

/** `parte / total × 100` com 1 casa decimal; `null` se não há decididos. */
export function percentage(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10;
}
