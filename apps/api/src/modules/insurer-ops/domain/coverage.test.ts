// TC-COV-01..11 (BR-SEG-41): `evaluateCoverage` / `evaluateEligibility`.
import { describe, expect, it } from "vitest";
import { COVERAGE_REASONS, evaluateCoverage, evaluateEligibility, type CoverageBeneficiary, type CoverageLine, type CoverageOptions, type CoverageService } from "./coverage.js";

const SERVICE: CoverageService = { id: "s1", status: "ACTIVE" };
const LINE: CoverageLine = { serviceId: "s1", type: "LIMITED", copayPct: 80, limitPerYearMinor: 100000, waitingDays: 0, requiresAuthorization: true };
const WINDOW = { status: "ACTIVE", validFrom: "2026-01-01", validTo: "2026-12-31" };
const BENEFICIARY: CoverageBeneficiary = { status: "ACTIVE", policy: WINDOW };
const DAY = "2026-06-15";
const run = (over: { line?: Partial<CoverageLine> | null; beneficiary?: Partial<CoverageBeneficiary>; service?: Partial<CoverageService>; date?: string; options?: CoverageOptions } = {}) =>
  evaluateCoverage({ coverages: over.line === null ? [] : [{ ...LINE, ...over.line }] }, { ...BENEFICIARY, ...over.beneficiary }, { ...SERVICE, ...over.service }, over.date ?? DAY, over.options);

describe("evaluateCoverage", () => {
  it("TC-COV-01 BR-SEG-41: caso feliz", () => {
    expect(run()).toEqual({ covered: true, reason: "COVERED", copayPct: 80, requiresAuthorization: true, waitingDays: 0, waitingEndsOn: null, limitPerYearMinor: 100000, remainingMinor: 100000 });
  });

  it.each(["PENDING", "SUSPENDED", "CANCELLED"])("TC-COV-02 BR-SEG-01: beneficiário %s ⇒ BENEFICIARY_NOT_ACTIVE", (status) => {
    expect(run({ beneficiary: { status } })).toMatchObject({ covered: false, reason: "BENEFICIARY_NOT_ACTIVE" });
  });

  it.each(["DRAFT", "SUSPENDED", "EXPIRED", "CANCELLED"])("TC-COV-03 BR-SEG-01/30: apólice %s ⇒ POLICY_NOT_ACTIVE", (status) => {
    expect(run({ beneficiary: { policy: { ...WINDOW, status } } })).toMatchObject({ covered: false, reason: "POLICY_NOT_ACTIVE" });
  });
  it("TC-COV-03: sem apólice ⇒ POLICY_NOT_ACTIVE", () => {
    expect(run({ beneficiary: { policy: null } })).toMatchObject({ covered: false, reason: "POLICY_NOT_ACTIVE", waitingEndsOn: null });
  });

  it.each([
    ["véspera", "2025-12-31", "OUTSIDE_POLICY_PERIOD"],
    ["validFrom", "2026-01-01", "COVERED"],
    ["validTo", "2026-12-31", "COVERED"],
    ["dia seguinte", "2027-01-01", "OUTSIDE_POLICY_PERIOD"],
  ])("TC-COV-04 BR-SEG-01: janela inclusiva (%s)", (_name, date, reason) => {
    expect(run({ date }).reason).toBe(reason);
  });

  it("TC-COV-05 BR-SEG-02/09/22: serviço inativo, fora do plano e excluído", () => {
    expect(run({ service: { status: "INACTIVE" } }).reason).toBe("SERVICE_INACTIVE");
    expect(run({ line: null }).reason).toBe("NOT_IN_PLAN");
    expect(run({ line: { type: "EXCLUDED" } })).toMatchObject({ covered: false, reason: "EXCLUDED" });
    expect(run({ line: null }).requiresAuthorization).toBe(false);
  });

  it("TC-COV-06 BR-SEG-04/31: carência de 30 dias desde validFrom", () => {
    const line = { waitingDays: 30 };
    expect(run({ line, date: "2026-01-30" })).toMatchObject({ covered: false, reason: "WAITING_PERIOD", waitingEndsOn: "2026-01-31" });
    expect(run({ line, date: "2026-01-31" })).toMatchObject({ covered: true, reason: "COVERED", waitingEndsOn: "2026-01-31" });
    expect(run({ line: { waitingDays: 0 }, date: "2026-01-01" })).toMatchObject({ covered: true, waitingEndsOn: null });
  });

  it.each([true, false])("TC-COV-07 BR-SEG-02: requiresAuthorization=%s propagado sem alterar covered", (requiresAuthorization) => {
    expect(run({ line: { requiresAuthorization } })).toMatchObject({ covered: true, requiresAuthorization });
  });

  it("TC-COV-08 BR-SEG-06/08: comparticipação 80 % de 2 000 000", () => {
    expect(run({ line: { limitPerYearMinor: null }, options: { amountMinor: 2000000 } })).toMatchObject({ insurerShareMinor: 1600000, patientShareMinor: 400000 });
  });

  it("TC-COV-08 BR-SEG-06/08: propriedade — soma = total, 0 ≤ seguradora ≤ total, half-up (grelha)", () => {
    for (const amountMinor of [0, 1, 2, 3, 99, 100, 101, 12345, 2000000, 999999999]) {
      for (const copayPct of [0, 0.5, 12.5, 33.33, 50, 50.5, 66.67, 80, 99.99, 100]) {
        const d = run({ line: { copayPct, limitPerYearMinor: null }, options: { amountMinor } });
        expect((d.insurerShareMinor ?? -1) + (d.patientShareMinor ?? -1)).toBe(amountMinor);
        expect(d.insurerShareMinor).toBeGreaterThanOrEqual(0);
        expect(d.insurerShareMinor).toBeLessThanOrEqual(amountMinor);
      }
    }
    // half-up: 5 × 50 % = 2,5 → 3 ; 3 × 50 % = 1,5 → 2 ; 1 × 49,99 % = 0,4999 → 0
    expect(run({ line: { copayPct: 50, limitPerYearMinor: null }, options: { amountMinor: 5 } }).insurerShareMinor).toBe(3);
    expect(run({ line: { copayPct: 50, limitPerYearMinor: null }, options: { amountMinor: 3 } }).insurerShareMinor).toBe(2);
    expect(run({ line: { copayPct: 49.99, limitPerYearMinor: null }, options: { amountMinor: 1 } }).insurerShareMinor).toBe(0);
  });

  it("TC-COV-09 BR-SEG-07/08: saldo do teto anual", () => {
    const usage = { usedMinor: 60000, reservedMinor: 20000 };
    expect(run({ options: { usage } })).toMatchObject({ covered: true, remainingMinor: 20000 });
    expect(run({ options: { usage, amountMinor: 50000 } })).toMatchObject({ insurerShareMinor: 20000, patientShareMinor: 30000 });
    expect(run({ options: { usage: { usedMinor: 100000, reservedMinor: 0 } } })).toMatchObject({ covered: false, reason: "LIMIT_EXHAUSTED", remainingMinor: 0 });
    expect(run({ options: { usage: { usedMinor: 150000, reservedMinor: 0 } } }).remainingMinor).toBe(0);
    expect(run({ options: {} })).toMatchObject({ remainingMinor: 100000 });
    expect(run({ line: { type: "INCLUDED", limitPerYearMinor: null }, options: { usage } })).toMatchObject({ covered: true, limitPerYearMinor: null, remainingMinor: null });
  });

  it("TC-COV-09: sem consumo informado não há LIMIT_EXHAUSTED (teto 0, Fase A)", () => {
    expect(run({ line: { limitPerYearMinor: 0 } })).toMatchObject({ covered: true, remainingMinor: 0 });
  });

  it("TC-COV-10 BR-SEG-41: precedência — a primeira razão da ordem, em todos os pares adjacentes", () => {
    const failing = {
      BENEFICIARY_NOT_ACTIVE: { beneficiary: { status: "SUSPENDED" } },
      POLICY_NOT_ACTIVE: { beneficiary: { policy: { ...WINDOW, status: "SUSPENDED" } } },
      OUTSIDE_POLICY_PERIOD: { date: "2027-02-01" },
      SERVICE_INACTIVE: { service: { status: "INACTIVE" } },
      NOT_IN_PLAN: { line: null },
      EXCLUDED: { line: { type: "EXCLUDED" as const } },
      WAITING_PERIOD: { line: { waitingDays: 400 } },
      LIMIT_EXHAUSTED: { options: { usage: { usedMinor: 100000, reservedMinor: 0 } } },
    } as const;
    const ordered = COVERAGE_REASONS.filter((r) => r !== "COVERED");
    for (const [i, first] of ordered.entries()) {
      const second = ordered[i + 1];
      if (second === undefined) break;
      const merged = { ...failing[second], ...failing[first] } as Parameters<typeof run>[0];
      // NOT_IN_PLAN e EXCLUDED/WAITING/LIMIT partilham `line`: a combinação usa a falha mais cedo.
      expect(run(merged).reason, `${first} antes de ${second}`).toBe(first);
    }
    expect(run().reason).toBe("COVERED");
  });

  it("TC-COV-11 BR-SEG-41: pura — mesma entrada, mesma saída, entrada congelada, sem relógio/ambiente", () => {
    const plan = Object.freeze({ coverages: Object.freeze([Object.freeze({ ...LINE })]) });
    const beneficiary = Object.freeze({ status: "ACTIVE", policy: Object.freeze({ ...WINDOW }) });
    const service = Object.freeze({ ...SERVICE });
    const options = Object.freeze({ amountMinor: 1000, usage: Object.freeze({ usedMinor: 1, reservedMinor: 2 }) });
    const first = evaluateCoverage(plan, beneficiary, service, DAY, options);
    expect(evaluateCoverage(plan, beneficiary, service, DAY, options)).toEqual(first);
    const env = process.env;
    const realNow = Date.now;
    Date.now = () => { throw new Error("relógio"); };
    Object.defineProperty(process, "env", { get: () => { throw new Error("ambiente"); }, configurable: true });
    try {
      expect(evaluateCoverage(plan, beneficiary, service, DAY, options)).toEqual(first);
    } finally {
      Date.now = realNow;
      Object.defineProperty(process, "env", { value: env, configurable: true, writable: true });
    }
  });
});

describe("evaluateEligibility (primeiro passo)", () => {
  it.each([
    [{ status: "ACTIVE", policy: BENEFICIARY.policy }, DAY, { eligible: true }],
    [{ status: "PENDING", policy: BENEFICIARY.policy }, DAY, { eligible: false, reason: "BENEFICIARY_NOT_ACTIVE" }],
    [{ status: "ACTIVE", policy: null }, DAY, { eligible: false, reason: "POLICY_NOT_ACTIVE" }],
    [{ status: "ACTIVE", policy: BENEFICIARY.policy }, "2027-01-01", { eligible: false, reason: "OUTSIDE_POLICY_PERIOD" }],
  ])("BR-SEG-01 %#", (beneficiary, date, expected) => {
    expect(evaluateEligibility(beneficiary, date)).toEqual(expected);
  });
});
