import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { ClinicPortalActor } from "./ports.js";
import { createClinicsFixtures } from "./fixtures.js";
import { createCreateClinicStaffUseCase, createListClinicStaffUseCase, createRemoveClinicStaffUseCase } from "./manage-clinic-staff.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

const ADMIN_A: ClinicPortalActor = { clinicAccountId: "admin-a", clinicId: CLINIC_A, role: "CLINIC_ADMIN" };
const MANAGER_A: ClinicPortalActor = { clinicAccountId: "manager-a", clinicId: CLINIC_A, role: "CLINIC_MANAGER" };
const ADMIN_B: ClinicPortalActor = { clinicAccountId: "admin-b", clinicId: CLINIC_B, role: "CLINIC_ADMIN" };

describe("createClinicStaff (BR-CLN-05)", () => {
  it("CLINIC_ADMIN cria CLINIC_MANAGER na própria clínica e envia a password por e-mail", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);

    const account = await createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX);

    expect(account.role).toBe("CLINIC_MANAGER");
    expect(account.clinicId).toBe(CLINIC_A);
    expect(fixtures.clinicMailer.sent).toHaveLength(1);
    expect(fixtures.clinicMailer.sent[0]?.to).toBe("gestor@clinica.pt");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_STAFF_CREATE");
  });

  it("recusa CLINIC_MANAGER a criar outro Gestor (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);

    await expect(createStaff(MANAGER_A, { email: "gestor2@clinica.pt" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("e-mail já em uso -> VALIDATION_ERROR", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);
    await createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX);

    await expect(createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("listClinicStaff (BR-CLN-05)", () => {
  it("lista só os CLINIC_MANAGER da própria clínica, nunca o CLINIC_ADMIN nem de outra clínica", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);
    await createStaff(ADMIN_A, { email: "gestor1@clinica.pt" }, CTX);
    await createStaff(ADMIN_A, { email: "gestor2@clinica.pt" }, CTX);
    await createStaff(ADMIN_B, { email: "gestor-b@clinica.pt" }, CTX);
    fixtures.clinicAccountRepo.seed({
      id: "admin-a",
      clinicId: CLINIC_A,
      email: "admin@clinica.pt",
      passwordHash: "hash",
      role: "CLINIC_ADMIN",
      status: "ACTIVE",
      createdAt: NOW,
    });

    const listStaff = createListClinicStaffUseCase(fixtures.deps);
    const result = await listStaff(ADMIN_A);

    expect(result).toHaveLength(2);
    expect(result.every((a) => a.clinicId === CLINIC_A && a.role === "CLINIC_MANAGER")).toBe(true);
  });

  it("recusa CLINIC_MANAGER (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const listStaff = createListClinicStaffUseCase(fixtures.deps);
    await expect(listStaff(MANAGER_A)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("removeClinicStaff (BR-CLN-05/endpoints.md removeClinicStaff)", () => {
  it("CLINIC_ADMIN remove um CLINIC_MANAGER da própria clínica", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);
    const staff = await createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX);

    const removeStaff = createRemoveClinicStaffUseCase(fixtures.deps);
    await removeStaff(ADMIN_A, staff.id, CTX);

    expect(fixtures.clinicAccountRepo.byId.has(staff.id)).toBe(false);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_STAFF_REMOVE");
  });

  it("NOT_FOUND para conta de outra clínica (nunca enumera)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);
    const staffB = await createStaff(ADMIN_B, { email: "gestor-b@clinica.pt" }, CTX);

    const removeStaff = createRemoveClinicStaffUseCase(fixtures.deps);
    await expect(removeStaff(ADMIN_A, staffB.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("NOT_FOUND ao tentar remover a conta CLINIC_ADMIN raiz", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    fixtures.clinicAccountRepo.seed({
      id: "admin-a",
      clinicId: CLINIC_A,
      email: "admin@clinica.pt",
      passwordHash: "hash",
      role: "CLINIC_ADMIN",
      status: "ACTIVE",
      createdAt: NOW,
    });

    const removeStaff = createRemoveClinicStaffUseCase(fixtures.deps);
    await expect(removeStaff(ADMIN_A, "admin-a", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recusa CLINIC_MANAGER (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const removeStaff = createRemoveClinicStaffUseCase(fixtures.deps);
    await expect(removeStaff(MANAGER_A, "whatever", CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
