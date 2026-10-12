import { describe, expect, it } from "vitest";
import type { ClinicAccount } from "./clinic-account.js";
import { assertCanManageStaff, assertRemovableStaffTarget } from "./clinic-staff-hierarchy.js";

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

function account(overrides: Partial<ClinicAccount> = {}): ClinicAccount {
  return {
    id: "acc-1",
    clinicId: CLINIC_A,
    email: "manager@clinica.pt",
    passwordHash: "hash",
    role: "CLINIC_MANAGER",
    status: "ACTIVE",
    createdAt: new Date("2026-10-12T10:00:00Z"),
    ...overrides,
  };
}

describe("assertCanManageStaff (BR-CLN-05)", () => {
  it("permite CLINIC_ADMIN", () => {
    expect(() => {
      assertCanManageStaff({ clinicId: CLINIC_A, role: "CLINIC_ADMIN" });
    }).not.toThrow();
  });

  it("recusa CLINIC_MANAGER (FORBIDDEN)", () => {
    expect(() => {
      assertCanManageStaff({ clinicId: CLINIC_A, role: "CLINIC_MANAGER" });
    }).toThrow();
  });
});

describe("assertRemovableStaffTarget (BR-CLN-05/endpoints.md removeClinicStaff)", () => {
  const actor = { clinicId: CLINIC_A, role: "CLINIC_ADMIN" as const };

  it("devolve o alvo quando é CLINIC_MANAGER da própria clínica", () => {
    const target = account();
    expect(assertRemovableStaffTarget(actor, target)).toBe(target);
  });

  it("NOT_FOUND quando o alvo não existe", () => {
    expect(() => assertRemovableStaffTarget(actor, null)).toThrow();
  });

  it("NOT_FOUND quando o alvo é de outra clínica (nunca enumera)", () => {
    expect(() => assertRemovableStaffTarget(actor, account({ clinicId: CLINIC_B }))).toThrow();
  });

  it("NOT_FOUND quando o alvo é a conta CLINIC_ADMIN raiz (só o Platform Admin repõe)", () => {
    expect(() => assertRemovableStaffTarget(actor, account({ role: "CLINIC_ADMIN" }))).toThrow();
  });
});
