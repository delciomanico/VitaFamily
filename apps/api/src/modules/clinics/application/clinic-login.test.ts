import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { hashClinicPassword } from "../domain/clinic-account-password.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import { createClinicsFixtures } from "./fixtures.js";
import { createClinicLoginUseCase } from "./clinic-login.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

async function seedAccount(
  fixtures: ReturnType<typeof createClinicsFixtures>,
  overrides: Partial<ClinicAccount> = {},
): Promise<ClinicAccount> {
  const account: ClinicAccount = {
    id: "ca1",
    clinicId: "clinic1",
    email: "gestor@clinica.pt",
    passwordHash: await hashClinicPassword("Correcto-Cavalo-7"),
    role: "CLINIC_MANAGER",
    status: "ACTIVE",
    createdAt: NOW,
    ...overrides,
  };
  fixtures.clinicAccountRepo.seed(account);
  return account;
}

describe("clinicLogin (D17/D18, ADR-020)", () => {
  it("devolve tokens e cria sessão com sucesso", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures);
    const login = createClinicLoginUseCase(fixtures.deps);

    const result = await login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT);

    expect(result.accessToken).toBeTruthy();
    expect(result.expiresIn).toBe(900);
    expect(result.clinicId).toBe("clinic1");
    expect(result.role).toBe("CLINIC_MANAGER");
    expect(fixtures.clinicSessionRepo.sessions.size).toBe(1);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_ACCOUNT_LOGIN");
    expect(fixtures.audit.events[0]?.actorType).toBe("CLINIC_ACCOUNT");
  });

  it("credenciais inválidas -> AUTH_INVALID_CREDENTIALS e audita CLINIC_ACCOUNT_LOGIN_FAILED", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures);
    const login = createClinicLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "gestor@clinica.pt", password: "palavra-errada" }, CONTEXT),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_ACCOUNT_LOGIN_FAILED");
  });

  it("e-mail inexistente -> AUTH_INVALID_CREDENTIALS (mensagem genérica, errors.md)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    const login = createClinicLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "inexistente@clinica.pt", password: "qualquer-coisa" }, CONTEXT),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  });

  it("authorization.md §6.1: conta SUSPENDED é recusada (ACCOUNT_SUSPENDED)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures, { status: "SUSPENDED" });
    const login = createClinicLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });

  it("bloqueia depois de 5 falhas em 15 minutos (mesmo e-mail+IP)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    await seedAccount(fixtures);
    const login = createClinicLoginUseCase(fixtures.deps);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login({ email: "gestor@clinica.pt", password: "errada" }, CONTEXT),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }

    await expect(
      login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
