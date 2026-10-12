import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { hashClinicPassword } from "../domain/clinic-account-password.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import { createClinicsFixtures } from "./fixtures.js";
import { createClinicLoginUseCase } from "./clinic-login.js";
import { createClinicLogoutUseCase } from "./clinic-logout.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CONTEXT = { requestId: "req-1" };

describe("clinicLogout", () => {
  it("revoga a sessão atual e audita CLINIC_ACCOUNT_LOGOUT", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    const account: ClinicAccount = {
      id: "ca1",
      clinicId: "clinic1",
      email: "gestor@clinica.pt",
      passwordHash: await hashClinicPassword("Correcto-Cavalo-7"),
      role: "CLINIC_MANAGER",
      status: "ACTIVE",
      createdAt: NOW,
    };
    fixtures.clinicAccountRepo.seed(account);
    const login = createClinicLoginUseCase(fixtures.deps);
    const logout = createClinicLogoutUseCase(fixtures.deps);

    await login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT);
    const [session] = [...fixtures.clinicSessionRepo.sessions.values()];
    if (!session) throw new Error("sessão esperada");

    await logout(account.id, session.id, CONTEXT);

    expect(fixtures.clinicSessionRepo.sessions.get(session.id)?.revokedAt).toBeTruthy();
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_ACCOUNT_LOGOUT");
  });
});
