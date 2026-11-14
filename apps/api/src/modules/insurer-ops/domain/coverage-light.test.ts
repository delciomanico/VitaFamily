// TC-COV-14 (BR-SEG-43): `toEligibilityLight` mapeia SÓ a decisão de `evaluateCoverage` (tabela completa razão × requiresAuthorization).
import { describe, expect, it } from "vitest";
import { COVERAGE_REASONS, patientSharePctFor, toEligibilityLight, type CoverageReason } from "./coverage.js";

const EXPECTED: Record<CoverageReason, [withoutAuthorization: string, withAuthorization: string]> = {
  COVERED: ["GREEN", "YELLOW"],
  WAITING_PERIOD: ["YELLOW", "YELLOW"],
  LIMIT_EXHAUSTED: ["YELLOW", "YELLOW"],
  BENEFICIARY_NOT_ACTIVE: ["RED", "RED"],
  POLICY_NOT_ACTIVE: ["RED", "RED"],
  OUTSIDE_POLICY_PERIOD: ["RED", "RED"],
  SERVICE_INACTIVE: ["RED", "RED"],
  NOT_IN_PLAN: ["RED", "RED"],
  EXCLUDED: ["RED", "RED"],
};

describe("TC-COV-14 toEligibilityLight", () => {
  it.each(COVERAGE_REASONS.map((reason) => [reason] as const))("razão %s × requiresAuthorization", (reason) => {
    const [without, withAuth] = EXPECTED[reason];
    expect(toEligibilityLight({ reason, requiresAuthorization: false })).toBe(without);
    expect(toEligibilityLight({ reason, requiresAuthorization: true })).toBe(withAuth);
  });

  it("é pura: mesma entrada, mesma saída", () => {
    const input = { reason: "COVERED", requiresAuthorization: true } as const;
    expect(toEligibilityLight(input)).toBe(toEligibilityLight({ ...input }));
  });

  it("patientSharePct = 100 − % da seguradora; nulo se VERMELHO", () => {
    expect(patientSharePctFor("GREEN", 80)).toBe(20);
    expect(patientSharePctFor("YELLOW", 100)).toBe(0);
    expect(patientSharePctFor("YELLOW", 33.33)).toBe(66.67);
    expect(patientSharePctFor("RED", 80)).toBeNull();
  });
});
