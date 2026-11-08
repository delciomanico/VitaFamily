// UC-CLN-29 / BR-CLN-38: perfil da clínica (Admin edita, Gestor lê, Médico nada) e auditoria só com nomes de campos.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGetClinicProfileUseCase, createUpdateClinicProfileUseCase } from "./clinic-profile.js";
import { createClinicsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC = "clinic-a";
const ADMIN: ClinicPortalActor = { clinicAccountId: "a", clinicId: CLINIC, role: "CLINIC_ADMIN" };
const MANAGER: ClinicPortalActor = { ...ADMIN, clinicAccountId: "m", role: "CLINIC_MANAGER" };
const DOCTOR: ClinicPortalActor = { ...ADMIN, clinicAccountId: "d", role: "CLINIC_DOCTOR", professionalId: "p" };

async function setup() {
  const fixtures = createClinicsFixtures(new FixedClock(NOW));
  await fixtures.clinicsRepo.insert(undefined as never, { id: CLINIC, type: "PARTNER", name: "Clínica Sol", createdAt: NOW });
  return fixtures;
}

describe("perfil da clínica (BR-CLN-38)", () => {
  it("Admin edita parcialmente; null limpa; name e currency só leitura; Gestor lê", async () => {
    const fx = await setup();
    const update = createUpdateClinicProfileUseCase(fx.deps);
    const profile = await update(ADMIN, { displayName: "Sol Saúde", openingHours: "Seg-Sex 9-18", phone: "900000000" }, CTX);
    expect(profile).toMatchObject({ name: "Clínica Sol", displayName: "Sol Saúde", openingHours: "Seg-Sex 9-18", phone: "900000000" });
    expect((await update(ADMIN, { phone: null }, CTX)).phone).toBeNull();
    expect((await createGetClinicProfileUseCase(fx.deps)(MANAGER)).displayName).toBe("Sol Saúde");
    await expect(update(ADMIN, { name: "Outro" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(update(ADMIN, { currency: "EUR" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Gestor não escreve (FORBIDDEN); Médico não lê nem escreve (FORBIDDEN)", async () => {
    const fx = await setup();
    await expect(createUpdateClinicProfileUseCase(fx.deps)(MANAGER, { phone: "1" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUpdateClinicProfileUseCase(fx.deps)(DOCTOR, { phone: "1" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGetClinicProfileUseCase(fx.deps)(DOCTOR)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("auditoria CLINIC_PROFILE_UPDATE só com os nomes dos campos, nunca os valores", async () => {
    const fx = await setup();
    await createUpdateClinicProfileUseCase(fx.deps)(ADMIN, { description: "TEXTO-SECRETO", email: "x@y.pt" }, CTX);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_PROFILE_UPDATE", actorClinicId: CLINIC, metadata: { fields: "description,email" } });
    expect(JSON.stringify(fx.audit.events)).not.toContain("TEXTO-SECRETO");
  });
});
