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

  it("e-mail já em uso -> CONFLICT (BR-CLN-39)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createStaff = createCreateClinicStaffUseCase(fixtures.deps);
    await createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX);

    await expect(createStaff(ADMIN_A, { email: "gestor@clinica.pt" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
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

describe("createClinicStaff: Médico (BR-CLN-39, UC-CLN-30)", () => {
  const PROFESSIONAL = "prof-1";

  async function setup() {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    await fixtures.catalogRepo.insertProfessional(undefined as never, { id: PROFESSIONAL, clinicId: CLINIC_A, name: "Dra. Lima", specialty: null, createdAt: NOW });
    await fixtures.catalogRepo.insertProfessional(undefined as never, { id: "prof-b", clinicId: CLINIC_B, name: "Dr. Alheio", specialty: null, createdAt: NOW });
    return { fixtures, createStaff: createCreateClinicStaffUseCase(fixtures.deps) };
  }

  it("Admin cria Médico ligado a profissional ativo da própria clínica; auditoria com role e profissional interno", async () => {
    const { fixtures, createStaff } = await setup();
    const account = await createStaff(ADMIN_A, { email: "medico@clinica.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL }, CTX);
    expect(account).toMatchObject({ role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL, clinicId: CLINIC_A });
    expect(fixtures.audit.events.at(-1)).toMatchObject({ action: "CLINIC_STAFF_CREATE", metadata: { role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL } });
  });

  it.each([
    ["Médico sem profissional", { email: "a@c.pt", role: "CLINIC_DOCTOR" }, "VALIDATION_ERROR"],
    ["Gestor com profissional", { email: "a@c.pt", role: "CLINIC_MANAGER", professionalId: PROFESSIONAL }, "VALIDATION_ERROR"],
    ["papel CLINIC_ADMIN", { email: "a@c.pt", role: "CLINIC_ADMIN" }, "VALIDATION_ERROR"],
    ["profissional de outra clínica", { email: "a@c.pt", role: "CLINIC_DOCTOR", professionalId: "prof-b" }, "NOT_FOUND"],
    ["profissional inexistente", { email: "a@c.pt", role: "CLINIC_DOCTOR", professionalId: "nao-existe" }, "NOT_FOUND"],
  ])("%s", async (_name, input, code) => {
    const { createStaff } = await setup();
    await expect(createStaff(ADMIN_A, input, CTX)).rejects.toMatchObject({ code });
  });

  it("profissional inativo => NOT_FOUND; segunda conta Médico do mesmo profissional => CONFLICT", async () => {
    const { fixtures, createStaff } = await setup();
    await createStaff(ADMIN_A, { email: "m1@clinica.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL }, CTX);
    await expect(createStaff(ADMIN_A, { email: "m2@clinica.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    await fixtures.catalogRepo.insertProfessional(undefined as never, { id: "prof-2", clinicId: CLINIC_A, name: "Dr. Inativo", specialty: null, createdAt: NOW });
    await fixtures.catalogRepo.updateProfessional(undefined as never, "prof-2", { active: false });
    await expect(createStaff(ADMIN_A, { email: "m3@clinica.pt", role: "CLINIC_DOCTOR", professionalId: "prof-2" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Gestor não cria Médico (FORBIDDEN); a lista inclui Gestores e Médicos; o Admin remove um Médico", async () => {
    const { fixtures, createStaff } = await setup();
    await expect(createStaff(MANAGER_A, { email: "a@c.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const doctor = await createStaff(ADMIN_A, { email: "m1@clinica.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL }, CTX);
    await createStaff(ADMIN_A, { email: "g1@clinica.pt" }, CTX);
    expect((await createListClinicStaffUseCase(fixtures.deps)(ADMIN_A)).map((a) => a.role).sort()).toEqual(["CLINIC_DOCTOR", "CLINIC_MANAGER"]);
    await createRemoveClinicStaffUseCase(fixtures.deps)(ADMIN_A, doctor.id, CTX);
    expect((await createListClinicStaffUseCase(fixtures.deps)(ADMIN_A)).map((a) => a.role)).toEqual(["CLINIC_MANAGER"]);
  });
});
