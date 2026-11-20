// ADR-038 §5: rotas de conta de profissional falham fechadas (503) com o suporte dos limitadores em falha e
// mantêm o 429 quando o limite é excedido. O limitador é a primeira operação de cada caso de uso.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { RateLimiterUnavailableError, type RateLimiter } from "../../../platform/rate-limit/async.js";
import { FailingRateLimiter } from "../../../platform/rate-limit/failing.js";
import { createUploadCredentialUseCase } from "./credentials.js";
import { createForgotPasswordUseCase } from "./forgot-password.js";
import { createLoginUseCase } from "./login.js";
import { createRegisterUseCase } from "./register.js";
import { createResendVerificationUseCase } from "./resend-verification.js";
import { createResetPasswordUseCase } from "./reset-password.js";
import { createVerifyEmailUseCase } from "./verify-email.js";
import type { ProfessionalsDeps } from "./ports.js";

const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };
type Deps = ProfessionalsDeps<unknown>;

const cases: [string, (d: Deps) => Promise<unknown>][] = [
  ["login", (d) => createLoginUseCase(d)({ email: "a@b.pt", password: "x" }, CONTEXT)],
  ["register", (d) => createRegisterUseCase(d)({ email: "a@b.pt", password: "x", termsVersion: "1" }, CONTEXT)],
  ["forgot-password", (d) => createForgotPasswordUseCase(d)("a@b.pt", CONTEXT)],
  ["reset-password", (d) => createResetPasswordUseCase(d)("a@b.pt", "code", "x", CONTEXT)],
  ["verify-email", (d) => createVerifyEmailUseCase(d)("a@b.pt", "code", CONTEXT)],
  ["resend-verification", (d) => createResendVerificationUseCase(d)("a@b.pt", CONTEXT)],
  [
    "credential-upload",
    (d) => createUploadCredentialUseCase(d)({ professionalAccountId: "pa1" } as never, { fields: {}, file: { buffer: Buffer.alloc(1) } }, CONTEXT),
  ],
];

describe("professionals: limitador em falha e 429", () => {
  it.each(cases)("%s: 503 com o limitador em falha", async (_name, call) => {
    const rateLimiter = new FailingRateLimiter(new FixedClock(new Date("2026-10-12T10:00:00Z")), "professionals");
    await expect(call({ rateLimiter } as unknown as Deps)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it.each(cases)("%s: 429 (RATE_LIMITED) quando o limitador recusa", async (_name, call) => {
    const rateLimiter: RateLimiter = {
      consume: () => Promise.resolve({ allowed: false, retryAfterMs: 1_000 }),
      peek: () => Promise.resolve({ allowed: false, retryAfterMs: 1_000 }),
      reset: () => Promise.resolve(),
    };
    await expect(call({ rateLimiter } as unknown as Deps)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
