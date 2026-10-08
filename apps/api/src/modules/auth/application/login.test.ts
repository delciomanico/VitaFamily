import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { hashPassword } from "../domain/password.js";
import { createAuthFixtures } from "./fixtures.js";
import { createLoginUseCase } from "./login.js";
import type { User } from "../../users/index.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

async function seedUser(
  fixtures: ReturnType<typeof createAuthFixtures>,
  overrides: Partial<User> = {},
): Promise<User> {
  const user: User = {
    id: "u1",
    email: "ana@example.com",
    passwordHash: await hashPassword("Correcto-Cavalo-7"),
    name: "Ana",
    birthDate: "1990-01-01",
    timezone: "Europe/Lisbon",
    status: "ACTIVE",
    platformRole: "NONE",
    termsAcceptedVersion: "1.0.0",
    termsAcceptedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
  fixtures.usersPort.seed(user);
  return user;
}

describe("login (UC-ACC-02)", () => {
  it("devolve tokens e cria sessão com sucesso", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    await seedUser(fixtures);
    const login = createLoginUseCase(fixtures.deps);

    const result = await login({ email: "ana@example.com", password: "Correcto-Cavalo-7" }, CONTEXT);

    expect(result.accessToken).toBeTruthy();
    expect(result.expiresIn).toBe(900);
    expect(fixtures.sessionRepo.sessions.size).toBe(1);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("AUTH_LOGIN");
  });

  it("credenciais inválidas -> AUTH_INVALID_CREDENTIALS e audita AUTH_LOGIN_FAILED", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    await seedUser(fixtures);
    const login = createLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "ana@example.com", password: "palavra-errada-123" }, CONTEXT),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(fixtures.audit.events.map((e) => e.action)).toContain("AUTH_LOGIN_FAILED");
  });

  it("AC-ACC-04: conta suspensa é recusada (ACCOUNT_SUSPENDED)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    await seedUser(fixtures, { status: "SUSPENDED" });
    const login = createLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "ana@example.com", password: "Correcto-Cavalo-7" }, CONTEXT),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });

  it("conta não verificada é recusada (EMAIL_NOT_VERIFIED)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    await seedUser(fixtures, { status: "PENDING_VERIFICATION" });
    const login = createLoginUseCase(fixtures.deps);

    await expect(
      login({ email: "ana@example.com", password: "Correcto-Cavalo-7" }, CONTEXT),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("bloqueia depois de 5 falhas em 15 minutos (mesma e-mail+IP)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    await seedUser(fixtures);
    const login = createLoginUseCase(fixtures.deps);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login({ email: "ana@example.com", password: "errada" }, CONTEXT),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }

    await expect(
      login({ email: "ana@example.com", password: "Correcto-Cavalo-7" }, CONTEXT),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
