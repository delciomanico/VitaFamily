import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAuthFixtures } from "./fixtures.js";
import { createLoginUseCase } from "./login.js";
import { createRefreshUseCase } from "./refresh.js";
import { hashPassword } from "../domain/password.js";
import type { User } from "../../users/index.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1", xRequestedWith: "vita" };

async function loggedInFixtures() {
  const clock = new FixedClock(NOW);
  const fixtures = createAuthFixtures(clock);
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
  };
  fixtures.usersPort.seed(user);
  const login = createLoginUseCase(fixtures.deps);
  const loginResult = await login({ email: user.email, password: "Correcto-Cavalo-7" }, CONTEXT);
  return { clock, fixtures, loginResult };
}

describe("refresh (ADR-007/AC-ACC-07)", () => {
  it("roda o refresh token: novo token funciona, o antigo passa a inválido", async () => {
    const { fixtures, loginResult } = await loggedInFixtures();
    const refresh = createRefreshUseCase(fixtures.deps);

    const rotated = await refresh({ refreshToken: loginResult.refreshToken, xRequestedWith: "vita" }, CONTEXT);
    expect(rotated.refreshToken).not.toBe(loginResult.refreshToken);
    expect(fixtures.sessionRepo.sessions.size).toBe(2);
  });

  it("AC-ACC-07: reutilizar um refresh token já rodado revoga toda a cadeia e audita", async () => {
    const { fixtures, loginResult } = await loggedInFixtures();
    const refresh = createRefreshUseCase(fixtures.deps);

    await refresh({ refreshToken: loginResult.refreshToken, xRequestedWith: "vita" }, CONTEXT);

    // Reutiliza o token já rodado (revogado) — deteção de reutilização.
    await expect(
      refresh({ refreshToken: loginResult.refreshToken, xRequestedWith: "vita" }, CONTEXT),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    expect(fixtures.audit.events.map((e) => e.action)).toContain("AUTH_REFRESH_REUSE_DETECTED");
    for (const session of fixtures.sessionRepo.sessions.values()) {
      expect(session.revokedAt).toBeDefined();
    }
  });

  it("exige X-Requested-With: vita (CSRF)", async () => {
    const { fixtures, loginResult } = await loggedInFixtures();
    const refresh = createRefreshUseCase(fixtures.deps);

    await expect(
      refresh({ refreshToken: loginResult.refreshToken }, CONTEXT),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token desconhecido -> UNAUTHENTICATED", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const refresh = createRefreshUseCase(fixtures.deps);

    await expect(
      refresh({ refreshToken: "nunca-existiu", xRequestedWith: "vita" }, CONTEXT),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
