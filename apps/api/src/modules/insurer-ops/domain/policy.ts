// Apólice da seguradora (entities.md `Policy`, state-machines.md «Policy», UC-SEG-03). Distinta de `InsurancePolicy`
// (cartão do paciente, ADR-021). Entidade e regras puras.
import { ConflictError, DomainError } from "../../../platform/errors/index.js";
import { fail, requireIsoDate, requireNote, requireText } from "./validation.js";

export type PolicyStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";
export const POLICY_STATUSES: PolicyStatus[] = ["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"];
export type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface Policy {
  id: string;
  insurerId: string;
  number: string;
  planId: string;
  planName: string;
  planVersion: number;
  companyId: string | null;
  holderId: string;
  validFrom: string;
  validTo: string;
  status: PolicyStatus;
  /** Nota da última passagem a SUSPENDED/CANCELLED (BR-SEG-24). */
  statusNote: string | null;
  createdAt: Date;
}

export interface ParsedPolicyInput {
  planId: string;
  holderId: string;
  companyId: string | null;
  number: string;
  validFrom: string;
  validTo: string;
}

export function assertValidRange(validFrom: string, validTo: string): void {
  if (validTo < validFrom) fail("validTo", "não pode ser anterior a validFrom");
}

export function parsePolicyInput(input: Record<string, unknown>): ParsedPolicyInput {
  const planId = requireText(input.planId, "planId", 36);
  const holderId = requireText(input.holderId, "holderId", 36);
  const validFrom = requireIsoDate(input.validFrom, "validFrom");
  const validTo = requireIsoDate(input.validTo, "validTo");
  assertValidRange(validFrom, validTo);
  return {
    planId,
    holderId,
    companyId: typeof input.companyId === "string" ? input.companyId : null,
    number: requireText(input.number, "number", 60),
    validFrom,
    validTo,
  };
}

export interface PolicyPatch {
  planId?: string;
  companyId?: string | null;
  validFrom?: string;
  validTo?: string;
}

export function parsePolicyPatch(input: Record<string, unknown>): PolicyPatch {
  const patch: PolicyPatch = {};
  if (input.planId !== undefined) patch.planId = requireText(input.planId, "planId", 36);
  if (input.companyId !== undefined) {
    if (input.companyId !== null && typeof input.companyId !== "string") fail("companyId", "uuid ou null");
    patch.companyId = input.companyId;
  }
  if (input.validFrom !== undefined) patch.validFrom = requireIsoDate(input.validFrom, "validFrom");
  if (input.validTo !== undefined) patch.validTo = requireIsoDate(input.validTo, "validTo");
  return patch;
}

/** `EXPIRED` e `CANCELLED` são finais (state-machines.md). */
export function isFinalPolicyStatus(status: PolicyStatus): boolean {
  return status === "EXPIRED" || status === "CANCELLED";
}

/** UC-SEG-03: datas/empresa em qualquer estado não final; `planId` só em `DRAFT` (senão = nova versão do plano, UC-SEG-04). */
export function assertPolicyEditable(policy: Policy, patch: PolicyPatch): void {
  if (isFinalPolicyStatus(policy.status)) {
    throw new ConflictError({ detail: "A apólice está num estado final e já não pode ser alterada." });
  }
  if (patch.planId !== undefined && patch.planId !== policy.planId && policy.status !== "DRAFT") {
    throw new ConflictError({ detail: "O plano só se altera numa apólice em rascunho (use uma nova versão do plano)." });
  }
}

const TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  EXPIRED: [],
  CANCELLED: [],
};

/**
 * state-machines.md «Policy»: `DRAFT→ACTIVE` exige plano `ACTIVE`; `SUSPENDED`/`CANCELLED` exigem nota; `EXPIRED` é só do
 * job `insurer.expire-policies` (nunca aceite por este caminho).
 */
export function assertPolicyTransition(policy: Policy, planStatus: PlanStatus, to: unknown, note: unknown): PolicyStatus {
  if (to !== "ACTIVE" && to !== "SUSPENDED" && to !== "CANCELLED") fail("status", "ACTIVE, SUSPENDED ou CANCELLED");
  if (to === "SUSPENDED" || to === "CANCELLED") requireNote(note);
  if (!TRANSITIONS[policy.status].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado não permitida." });
  }
  if (policy.status === "DRAFT" && to === "ACTIVE" && planStatus !== "ACTIVE") {
    throw new ConflictError({ detail: "O plano da apólice tem de estar ativo." });
  }
  return to;
}
