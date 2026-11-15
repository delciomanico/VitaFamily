// Auto-aprovação (BR-AUT-03/23, ADR-035 §4): função PURA `podeAutoAprovar` sobre as regras da seguradora (dados) e a
// `CoverageDecision` de `evaluateCoverage` (única fonte de cobertura, ADR-033). Sem relógio, I/O nem texto de UI; o resultado é
// um rasto só de códigos (`{check, ok, reason}`), nunca dados pessoais. Sem `if (serviceCode …)` nem literais de tipo de serviço:
// tipo de regra novo = ADR; regra nova = dados. Corre UMA vez, na criação de um pedido que não é recurso (nunca em resposta,
// reabertura ou recurso). Carência e limite esgotado NUNCA se auto-aprovam (Q-A1).
import type { CoverageDecision } from "./coverage.js";

export interface AutoApprovalRule {
  id: string;
  name: string;
  /** Exatamente um dos dois alvos (CHECK da BD). */
  serviceKindId: string | null;
  serviceId: string | null;
  maxAmountMinor: number;
  active: boolean;
}

export const AUTO_APPROVAL_CHECKS = ["NOT_APPEAL", "COVERED_REQUIRES_AUTHORIZATION", "WITHIN_LIMIT", "RULE_MATCH"] as const;
export type AutoApprovalCheckName = (typeof AUTO_APPROVAL_CHECKS)[number];

export interface AutoApprovalCheck {
  check: AutoApprovalCheckName;
  ok: boolean;
  /** Código: `OK`, `IS_APPEAL`, um `CoverageReason`, `AUTHORIZATION_NOT_REQUIRED`, `AMOUNT_ABOVE_LIMIT`, `NO_RULE_FOR_SERVICE`, `AMOUNT_ABOVE_RULE_MAX`. */
  reason: string;
}

export interface AutoApprovalTrace {
  ok: boolean;
  ruleId: string | null;
  ruleName: string | null;
  checks: AutoApprovalCheck[];
}

export interface AutoApprovalRequest {
  isAppeal: boolean;
  serviceId: string;
  serviceKindId: string | null;
  requestedAmountMinor: number;
}

export type AutoApprovalCoverage = Pick<CoverageDecision, "reason" | "requiresAuthorization" | "remainingMinor">;

/** Regra aplicável: a ATIVA do serviço precede a do tipo de serviço (especificidade, como `resolvePolicySetting`). */
export function findApplicableRule(rules: readonly AutoApprovalRule[], request: Pick<AutoApprovalRequest, "serviceId" | "serviceKindId">): AutoApprovalRule | undefined {
  const active = rules.filter((r) => r.active);
  return active.find((r) => r.serviceId === request.serviceId) ?? (request.serviceKindId === null ? undefined : active.find((r) => r.serviceKindId === request.serviceKindId));
}

export function podeAutoAprovar(request: AutoApprovalRequest, coverage: AutoApprovalCoverage, rules: readonly AutoApprovalRule[]): AutoApprovalTrace {
  const rule = findApplicableRule(rules, request);
  const checks: AutoApprovalCheck[] = [];

  checks.push({ check: "NOT_APPEAL", ok: !request.isAppeal, reason: request.isAppeal ? "IS_APPEAL" : "OK" });

  // Só `COVERED` com «exige autorização»: a cor amarela por carência ou limite esgotado nunca se auto-aprova (Q-A1).
  const coveredAndRequires = coverage.reason === "COVERED" && coverage.requiresAuthorization;
  checks.push({ check: "COVERED_REQUIRES_AUTHORIZATION", ok: coveredAndRequires, reason: coverage.reason !== "COVERED" ? coverage.reason : coverage.requiresAuthorization ? "OK" : "AUTHORIZATION_NOT_REQUIRED" });

  const withinLimit = coverage.remainingMinor === null || request.requestedAmountMinor <= coverage.remainingMinor;
  checks.push({ check: "WITHIN_LIMIT", ok: withinLimit, reason: withinLimit ? "OK" : "AMOUNT_ABOVE_LIMIT" });

  if (rule === undefined) checks.push({ check: "RULE_MATCH", ok: false, reason: "NO_RULE_FOR_SERVICE" });
  else {
    const within = request.requestedAmountMinor <= rule.maxAmountMinor;
    checks.push({ check: "RULE_MATCH", ok: within, reason: within ? "OK" : "AMOUNT_ABOVE_RULE_MAX" });
  }

  return { ok: checks.every((c) => c.ok), ruleId: rule?.id ?? null, ruleName: rule?.name ?? null, checks };
}
