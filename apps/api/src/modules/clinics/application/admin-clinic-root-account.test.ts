import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAdminClinicRootAccountUseCase, createAdminCreateClinicUseCase } from "./admin-clinics.js";
import { createClinicsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CTX = { requestId: "req-1" };
const PLATFORM_ADMIN = { userId: "admin1", platformAdmin: true };
const NOT_ADMIN = { userId: "u1", platformAdmin: false };

describe("adminCreateOrResetClinicRootAccount (BR-CLN-05, D18)", () => {
  it("cria a conta CLINIC_ADMIN raiz e envia a password por e-mail (nunca na resposta)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const clinic = await createClinic(PLATFORM_ADMIN, { name: "Clínica Sol" }, CTX);
    const rootAccount = createAdminClinicRootAccountUseCase(fixtures.deps);

    const account = await rootAccount(PLATFORM_ADMIN, clinic.id, { email: "admin@clinica.pt" }, CTX);

    expect(account.role).toBe("CLINIC_ADMIN");
    expect(account.clinicId).toBe(clinic.id);
    expect(account).not.toHaveProperty("passwordHashPlaintext");
    expect(fixtures.clinicMailer.sent).toHaveLength(1);
    expect(fixtures.clinicMailer.sent[0]?.to).toBe("admin@clinica.pt");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("ADMIN_CLINIC_ROOT_ACCOUNT_CREATE");
  });

  it("idempotente: repor substitui a credencial existente, nunca cria uma segunda conta", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const clinic = await createClinic(PLATFORM_ADMIN, { name: "Clínica Sol" }, CTX);
    const rootAccount = createAdminClinicRootAccountUseCase(fixtures.deps);

    const first = await rootAccount(PLATFORM_ADMIN, clinic.id, { email: "admin@clinica.pt" }, CTX);
    const second = await rootAccount(PLATFORM_ADMIN, clinic.id, { email: "admin@clinica.pt" }, CTX);

    expect(second.id).toBe(first.id);
    expect(fixtures.clinicAccountRepo.byId.size).toBe(1);
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  it("recusa quem não é Platform Admin (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const clinic = await createClinic(PLATFORM_ADMIN, { name: "Clínica Sol" }, CTX);
    const rootAccount = createAdminClinicRootAccountUseCase(fixtures.deps);

    await expect(rootAccount(NOT_ADMIN, clinic.id, { email: "admin@clinica.pt" }, CTX)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("clínica inexistente/privada -> NOT_FOUND", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const rootAccount = createAdminClinicRootAccountUseCase(fixtures.deps);

    await expect(rootAccount(PLATFORM_ADMIN, "clinica-inexistente", { email: "admin@clinica.pt" }, CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("e-mail já usado por outra conta -> VALIDATION_ERROR", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const createClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const clinicA = await createClinic(PLATFORM_ADMIN, { name: "Clínica A" }, CTX);
    const clinicB = await createClinic(PLATFORM_ADMIN, { name: "Clínica B" }, CTX);
    const rootAccount = createAdminClinicRootAccountUseCase(fixtures.deps);

    await rootAccount(PLATFORM_ADMIN, clinicA.id, { email: "admin@clinica.pt" }, CTX);

    await expect(rootAccount(PLATFORM_ADMIN, clinicB.id, { email: "admin@clinica.pt" }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
