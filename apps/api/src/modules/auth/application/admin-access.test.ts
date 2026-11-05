import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGetSessionStatsUseCase, createResetUserAccessUseCase } from "./admin-access.js";
import { createAuthFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const FUTURE = new Date("2027-01-01T00:00:00Z");

async function setup(status: "ACTIVE" | "PENDING_VERIFICATION" | "SUSPENDED" = "ACTIVE") {
  const fx = createAuthFixtures(new FixedClock(NOW));
  const user = await fx.usersPort.createAccount({}, {
    id: "u1", email: "ana@x.pt", passwordHash: "h", name: "Ana", birthDate: "1990-01-01", timezone: "Europe/Lisbon",
    termsAcceptedVersion: "1.0.0", termsAcceptedAt: NOW, createdAt: NOW,
  });
  if (status !== "PENDING_VERIFICATION") await fx.usersPort.setEmailVerified({}, user.id, NOW);
  for (const id of ["s1", "s2"]) {
    await fx.sessionRepo.insert({}, { id, userId: "u1", refreshTokenHash: id, tokenChainId: id, expiresAt: FUTURE, createdAt: NOW });
  }
  return fx;
}

describe("auth: reposição de acesso pelo admin (BR-ADM-02)", () => {
  it("conta ativa: revoga todas as sessões e envia a recuperação; devolve só o tipo", async () => {
    const fx = await setup();
    const kind = await createResetUserAccessUseCase(fx.deps)({}, "u1");
    expect(kind).toBe("PASSWORD_RESET");
    expect([...fx.sessionRepo.sessions.values()].every((s) => s.revokedAt)).toBe(true);
    expect(fx.mailer.sent).toHaveLength(1);
    expect(fx.mailer.sent[0]).toMatchObject({ to: "ana@x.pt", subject: expect.stringContaining("Recuperação") as string });
    expect([...fx.authTokenRepo.tokens.values()].filter((t) => t.type === "PASSWORD_RESET" && !t.usedAt)).toHaveLength(1);
  });

  it("conta por verificar recebe nova verificação", async () => {
    const fx = await setup("PENDING_VERIFICATION");
    expect(await createResetUserAccessUseCase(fx.deps)({}, "u1")).toBe("EMAIL_VERIFICATION");
    expect(fx.mailer.sent[0]?.subject).toContain("Verifique");
  });

  it("inexistente -> NOT_FOUND; 4.º pedido na hora -> RATE_LIMITED", async () => {
    const fx = await setup();
    const reset = createResetUserAccessUseCase(fx.deps);
    await expect(reset({}, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await reset({}, "u1");
    await reset({}, "u1");
    await reset({}, "u1");
    await expect(reset({}, "u1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("estatísticas: só sessões não revogadas e não expiradas contam", async () => {
    const fx = await setup();
    await fx.sessionRepo.revoke({}, "s1", NOW);
    expect(await createGetSessionStatsUseCase(fx.deps)({}, "u1")).toEqual({ activeCount: 1, lastUsedAt: NOW });
    expect(await createGetSessionStatsUseCase(fx.deps)({}, "nobody")).toEqual({ activeCount: 0, lastUsedAt: null });
  });
});
