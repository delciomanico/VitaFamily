import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createForgotPasswordUseCase } from "./forgot-password.js";
import { createAuthFixtures } from "./fixtures.js";
import { createResetPasswordUseCase } from "./reset-password.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CTX = { requestId: "r1", ip: "1.1.1.1" };

async function setup() {
  const fx = createAuthFixtures(new FixedClock(NOW));
  const user = await fx.usersPort.createAccount({}, {
    id: "u1", email: "ana@x.pt", passwordHash: "h", name: "Ana", birthDate: "1990-01-01", timezone: "Europe/Lisbon",
    termsAcceptedVersion: "1.0.0", termsAcceptedAt: NOW, createdAt: NOW,
  });
  await fx.usersPort.setEmailVerified({}, user.id, NOW);
  await fx.sessionRepo.insert({}, { id: "s1", userId: "u1", refreshTokenHash: "s1", tokenChainId: "s1", expiresAt: new Date("2027-01-01"), createdAt: NOW });
  await createForgotPasswordUseCase(fx.deps)("ana@x.pt", CTX);
  const code = /\b(\d{6})\b/.exec(fx.mailer.sent[0]?.text ?? "")?.[1] ?? "";
  return { fx, code };
}

describe("auth: recuperação por código OTP (UC-ACC-03)", () => {
  it("o e-mail traz um código de 6 dígitos", async () => {
    const { code } = await setup();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("código certo: define a palavra-passe, revoga sessões e é de uso único", async () => {
    const { fx, code } = await setup();
    const reset = createResetPasswordUseCase(fx.deps);
    await reset("Ana@x.pt", code, "NovaSenhaForte#2026", CTX);
    expect(fx.usersPort.byIdMap.get("u1")?.passwordHash).not.toBe("h");
    expect([...fx.sessionRepo.sessions.values()].every((s) => s.revokedAt)).toBe(true);
    await expect(reset("ana@x.pt", code, "OutraSenhaForte#2026", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("código errado ou e-mail desconhecido -> NOT_FOUND; 6.ª tentativa -> RATE_LIMITED", async () => {
    const { fx, code } = await setup();
    const wrong = code === "000000" ? "111111" : "000000";
    const reset = createResetPasswordUseCase(fx.deps);
    await expect(reset("ana@x.pt", wrong, "NovaSenhaForte#2026", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reset("outra@x.pt", code, "NovaSenhaForte#2026", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (let i = 0; i < 4; i++) await expect(reset("ana@x.pt", wrong, "NovaSenhaForte#2026", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reset("ana@x.pt", code, "NovaSenhaForte#2026", CTX)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
