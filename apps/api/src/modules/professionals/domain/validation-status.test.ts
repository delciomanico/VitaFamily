// Testes unitários da máquina de estados de validação (TC-MKT-05) e da matriz de escrita (BR-MKT-23). Sem I/O.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { InvalidStateTransitionError, ProfessionalLockedError } from "./errors.js";
import {
  EXPIRY_REASON,
  PROFESSIONAL_VALIDATION_STATUSES,
  assertCanWrite,
  canWrite,
  decideTransition,
  expireTransition,
  isVisible,
  normalizeDecisionReason,
  submitTransition,
  type ProfessionalDecision,
  type ProfessionalValidationStatus,
  type ProfessionalWriteOperation,
  type ValidationAction,
} from "./validation-status.js";

type Status = ProfessionalValidationStatus;

/** Apanha o erro lançado por `fn` (falha o teste se não lançar). */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("esperava-se um erro");
}

const DECISIONS: readonly ProfessionalDecision[] = ["APPROVE", "REJECT", "REQUEST_INFO", "SUSPEND", "REACTIVATE"];

/** Únicas combinações (estado, decisão) válidas, com o destino e a ação esperados (state-machines.md «Professional»). */
const VALID_DECISIONS: readonly (readonly [Status, ProfessionalDecision, Status, ValidationAction])[] = [
  ["PENDING_REVIEW", "APPROVE", "APPROVED", "APPROVED"],
  ["PENDING_REVIEW", "REJECT", "REJECTED", "REJECTED"],
  ["PENDING_REVIEW", "REQUEST_INFO", "NEEDS_INFO", "NEEDS_INFO"],
  ["APPROVED", "REQUEST_INFO", "NEEDS_INFO", "NEEDS_INFO"],
  ["REJECTED", "REQUEST_INFO", "NEEDS_INFO", "NEEDS_INFO"],
  ["APPROVED", "SUSPEND", "SUSPENDED", "SUSPENDED"],
  ["SUSPENDED", "REACTIVATE", "APPROVED", "REACTIVATED"],
];

/** 6 estados × 5 decisões = 30 casos; os restantes lançam `INVALID_STATE_TRANSITION`. */
const DECISION_MATRIX = PROFESSIONAL_VALIDATION_STATUSES.flatMap((status) =>
  DECISIONS.map((decision) => {
    const found = VALID_DECISIONS.find(([s, d]) => s === status && d === decision);
    return { status, decision, expected: found ? { to: found[2], action: found[3] } : null };
  }),
);

describe("decideTransition (TC-MKT-05)", () => {
  it("tem 7 transições válidas e 23 inválidas na matriz de 30 casos", () => {
    expect(DECISION_MATRIX).toHaveLength(30);
    expect(DECISION_MATRIX.filter((row) => row.expected !== null)).toHaveLength(7);
  });

  it.each(DECISION_MATRIX)("decideTransition($status, $decision) respeita a tabela", ({ status, decision, expected }) => {
    if (expected === null) {
      const error = captureError(() => decideTransition(status, decision));
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      expect(error).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      return;
    }
    expect(decideTransition(status, decision)).toMatchObject({ from: status, to: expected.to, action: expected.action, actor: "PLATFORM_ADMIN" });
  });

  it.each([
    ["APPROVE", false, true],
    ["REJECT", true, false],
    ["REQUEST_INFO", true, false],
    ["SUSPEND", true, false],
    ["REACTIVATE", false, true],
  ] as const)("%s exige motivo=%s e requisitos=%s", (decision, reasonRequired, requiresRequirements) => {
    const from = VALID_DECISIONS.find(([, d]) => d === decision)?.[0];
    expect(from).toBeDefined();
    if (from === undefined) return;
    expect(decideTransition(from, decision)).toMatchObject({ reasonRequired, requiresRequirements });
  });
});

describe("submitTransition", () => {
  it.each(["DRAFT", "NEEDS_INFO"] as const)("submete a partir de %s", (from) => {
    expect(submitTransition(from)).toEqual({
      from,
      to: "PENDING_REVIEW",
      action: "SUBMITTED",
      actor: "PROFESSIONAL",
      reasonRequired: false,
      requiresRequirements: true,
    });
  });

  it.each(PROFESSIONAL_VALIDATION_STATUSES.filter((s) => s !== "DRAFT" && s !== "NEEDS_INFO"))("recusa a partir de %s", (from) => {
    expect(captureError(() => submitTransition(from))).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("expireTransition (BR-MKT-21)", () => {
  it("caduca apenas APPROVED, com ator SYSTEM e ação EXPIRED", () => {
    expect(expireTransition("APPROVED")).toEqual({
      from: "APPROVED",
      to: "NEEDS_INFO",
      action: "EXPIRED",
      actor: "SYSTEM",
      reasonRequired: true,
      requiresRequirements: false,
    });
    expect(EXPIRY_REASON).toBe("Credencial caducada.");
  });

  it.each(PROFESSIONAL_VALIDATION_STATUSES.filter((s) => s !== "APPROVED"))("recusa a partir de %s", (from) => {
    expect(captureError(() => expireTransition(from))).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("normalizeDecisionReason (BR-MKT-18)", () => {
  const REQUIRED_ROWS = [
    ["PENDING_REVIEW", "REJECT"],
    ["PENDING_REVIEW", "REQUEST_INFO"],
    ["APPROVED", "SUSPEND"],
  ] as const;

  it.each(REQUIRED_ROWS)("exige motivo em %s/%s", (from, decision) => {
    const transition = decideTransition(from, decision);
    for (const reason of [undefined, null, "", "   "]) {
      expect(captureError(() => normalizeDecisionReason(transition, reason))).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: [{ field: "reason" }],
      });
    }
  });

  it("apara o motivo obrigatório", () => {
    const transition = decideTransition("PENDING_REVIEW", "REJECT");
    expect(normalizeDecisionReason(transition, "  Documento ilegível.  ")).toBe("Documento ilegível.");
  });

  it("aceita exatamente 500 caracteres (após aparar) e recusa 501", () => {
    const transition = decideTransition("PENDING_REVIEW", "REJECT");
    expect(normalizeDecisionReason(transition, `  ${"a".repeat(500)}  `)).toBe("a".repeat(500));
    expect(captureError(() => normalizeDecisionReason(transition, "a".repeat(501)))).toBeInstanceOf(ValidationError);
  });

  it.each([undefined, null, "", "   "])("devolve null quando o motivo é opcional e vem %j", (reason) => {
    const transition = decideTransition("PENDING_REVIEW", "APPROVE");
    expect(normalizeDecisionReason(transition, reason)).toBeNull();
  });

  it("mantém o motivo opcional quando preenchido, aparado", () => {
    const transition = decideTransition("SUSPENDED", "REACTIVATE");
    expect(normalizeDecisionReason(transition, " ok ")).toBe("ok");
  });

  it("recusa motivo com mais de 500 caracteres também quando é opcional", () => {
    const transition = decideTransition("PENDING_REVIEW", "APPROVE");
    expect(captureError(() => normalizeDecisionReason(transition, "x".repeat(501)))).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/** Matriz estado × operação (authorization.md §10.2, BR-MKT-23). */
const WRITE_MATRIX: readonly (readonly [Status, ProfessionalWriteOperation, boolean])[] = [
  ["DRAFT", "EDIT_IDENTITY", true],
  ["DRAFT", "EDIT_FREE_PROFILE", true],
  ["DRAFT", "EDIT_COMMERCIAL", true],
  ["PENDING_REVIEW", "EDIT_IDENTITY", false],
  ["PENDING_REVIEW", "EDIT_FREE_PROFILE", true],
  ["PENDING_REVIEW", "EDIT_COMMERCIAL", true],
  ["NEEDS_INFO", "EDIT_IDENTITY", true],
  ["NEEDS_INFO", "EDIT_FREE_PROFILE", true],
  ["NEEDS_INFO", "EDIT_COMMERCIAL", true],
  ["APPROVED", "EDIT_IDENTITY", false],
  ["APPROVED", "EDIT_FREE_PROFILE", true],
  ["APPROVED", "EDIT_COMMERCIAL", true],
  ["REJECTED", "EDIT_IDENTITY", false],
  ["REJECTED", "EDIT_FREE_PROFILE", false],
  ["REJECTED", "EDIT_COMMERCIAL", false],
  ["SUSPENDED", "EDIT_IDENTITY", false],
  ["SUSPENDED", "EDIT_FREE_PROFILE", false],
  ["SUSPENDED", "EDIT_COMMERCIAL", false],
];

describe("canWrite / assertCanWrite (BR-MKT-23)", () => {
  it("a matriz cobre 6 estados × 3 operações", () => {
    expect(WRITE_MATRIX).toHaveLength(18);
  });

  it.each(WRITE_MATRIX)("canWrite(%s, %s) = %s", (status, operation, allowed) => {
    expect(canWrite(status, operation)).toBe(allowed);
  });

  it.each(WRITE_MATRIX)("assertCanWrite(%s, %s) lança PROFESSIONAL_LOCKED quando %s", (status, operation, allowed) => {
    if (allowed) {
      expect(() => { assertCanWrite(status, operation); }).not.toThrow();
      return;
    }
    const error = captureError(() => { assertCanWrite(status, operation); });
    expect(error).toBeInstanceOf(ProfessionalLockedError);
    expect(error).toMatchObject({ code: "PROFESSIONAL_LOCKED" });
  });
});

describe("isVisible (BR-MKT-19/25)", () => {
  it.each(PROFESSIONAL_VALIDATION_STATUSES)("visível a famílias apenas em APPROVED (%s)", (status) => {
    expect(isVisible(status)).toBe(status === "APPROVED");
  });
});
