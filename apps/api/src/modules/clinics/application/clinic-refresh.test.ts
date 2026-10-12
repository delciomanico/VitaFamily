import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { hashClinicPassword } from "../domain/clinic-account-password.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import { createClinicsFixtures } from "./fixtures.js";
import { createClinicLoginUseCase } from "./clinic-login.js";
import { createClinicRefreshUseCase } from "./clinic-refresh.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

async function seedAccount(fixtures: ReturnType<typeof createClinicsFixtures>): Promise<ClinicAccount> {
  const account: ClinicAccount = {
    id: "ca1",
    clinicId: "clinic1",
    email: "gestor@clinica.pt",
    passwordHash: await hashClinicPassword("Correcto-Cavalo-7"),
    role: "CLINIC_ADMIN",
    status: "ACTIVE",
    createdAt: NOW,
  };
  fixtures.clinicAccountRepo.seed(account);
  return account;
}

describe("clinicRefresh (ADR-020, mesma política de /auth/refresh)", () => {
  it("roda o refresh token e devolve novos tokens", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures);
    const login = createClinicLoginUseCase(fixtures.deps);
    const refresh = createClinicRefreshUseCase(fixtures.deps);

    const loginResult = await login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT);
    const refreshResult = await refresh({ refreshToken: loginResult.refreshToken }, CONTEXT);

    expect(refreshResult.accessToken).toBeTruthy();
    expect(refreshResult.refreshToken).not.toBe(loginResult.refreshToken);
    expect(refreshResult.clinicId).toBe("clinic1");
    expect(refreshResult.role).toBe("CLINIC_ADMIN");
  });

  it("token inexistente -> UNAUTHENTICATED", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    const refresh = createClinicRefreshUseCase(fixtures.deps);

    await expect(refresh({ refreshToken: "nunca-existiu" }, CONTEXT)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("reutilização de um token já rodado revoga toda a cadeia (mesmo critério de AC-ACC-07)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures);
    const login = createClinicLoginUseCase(fixtures.deps);
    const refresh = createClinicRefreshUseCase(fixtures.deps);

    const loginResult = await login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT);
    await refresh({ refreshToken: loginResult.refreshToken }, CONTEXT);

    // Reutilizar o token já rodado (revogado) tem de falhar e revogar a cadeia inteira.
    await expect(refresh({ refreshToken: loginResult.refreshToken }, CONTEXT)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_ACCOUNT_REFRESH_REUSE_DETECTED");
    expect([...fixtures.clinicSessionRepo.sessions.values()].every((s) => s.revokedAt)).toBe(true);
  });
});
