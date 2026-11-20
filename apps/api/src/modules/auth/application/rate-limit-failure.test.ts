// ADR-038 §5: com o suporte dos limitadores em falha, as rotas de autenticação falham fechadas (503);
// um `reset` que falhe após login válido não impede o login.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { FailingRateLimiter } from "../../../platform/rate-limit/failing.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/in-memory.js";
import { RateLimiterUnavailableError, type RateLimitKey } from "../../../platform/rate-limit/async.js";
import { hashPassword } from "../domain/password.js";
import { createAuthFixtures } from "./fixtures.js";
import { createForgotPasswordUseCase } from "./forgot-password.js";
import { createLoginUseCase } from "./login.js";
import { createRegisterUseCase } from "./register.js";
import { createResendVerificationUseCase } from "./resend-verification.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

describe("auth com o limitador em falha", () => {
  it.each([
    ["login", (d: ReturnType<typeof createAuthFixtures>["deps"]) => createLoginUseCase(d)({ email: "a@b.pt", password: "x" }, CONTEXT)],
    ["forgot-password", (d: ReturnType<typeof createAuthFixtures>["deps"]) => createForgotPasswordUseCase(d)("a@b.pt", CONTEXT)],
    ["resend-verification", (d: ReturnType<typeof createAuthFixtures>["deps"]) => createResendVerificationUseCase(d)("a@b.pt", CONTEXT)],
    ["register", (d: ReturnType<typeof createAuthFixtures>["deps"]) =>
      createRegisterUseCase(d)({ email: "a@b.pt", password: "x", name: "A", birthDate: "1990-01-01", timezone: "Europe/Lisbon" } as never, CONTEXT)],
  ])("%s: 503 (RateLimiterUnavailableError), sem deixar passar", async (_name, call) => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const deps = { ...fixtures.deps, rateLimiter: new FailingRateLimiter(clock, "auth") };
    await expect(call(deps)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(fixtures.audit.events).toHaveLength(0);
  });

  it("login válido: reset que falha não impede o login e regista aviso", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    fixtures.usersPort.seed({
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
    });
    const inner = new InMemoryRateLimiter(clock, { namespace: "auth" });
    const rateLimiter = Object.assign(Object.create(inner) as InMemoryRateLimiter, {
      reset: (_key: RateLimitKey) => Promise.reject(new RateLimiterUnavailableError()),
    });
    const login = createLoginUseCase({ ...fixtures.deps, rateLimiter });

    const result = await login({ email: "ana@example.com", password: "Correcto-Cavalo-7" }, CONTEXT);

    expect(result.accessToken).toBeTruthy();
    expect(fixtures.logger.warnings.map((w) => w.msg)).toContain("Falha ao repor o contador de falhas de login");
  });
});
