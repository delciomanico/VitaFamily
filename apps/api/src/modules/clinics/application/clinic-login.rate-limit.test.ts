// ADR-038 §5: login de clínica falha fechado se o suporte dos limitadores falhar; `reset` falhado não impede o login.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { RateLimiterUnavailableError, type RateLimitKey } from "../../../platform/rate-limit/async.js";
import { FailingRateLimiter } from "../../../platform/rate-limit/failing.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/in-memory.js";
import { hashClinicPassword } from "../domain/clinic-account-password.js";
import { createClinicLoginUseCase } from "./clinic-login.js";
import { createClinicsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

describe("clinicLogin com o limitador em falha", () => {
  it("503 (RateLimiterUnavailableError) sem deixar passar", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    const login = createClinicLoginUseCase({ ...fixtures.deps, clinicRateLimiter: new FailingRateLimiter(clock, "clinics") });
    await expect(login({ email: "gestor@clinica.pt", password: "x" }, CONTEXT)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it("reset que falha após login válido não impede o login e regista aviso", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createClinicsFixtures(clock);
    fixtures.clinicAccountRepo.seed({
      id: "ca1",
      clinicId: "clinic1",
      email: "gestor@clinica.pt",
      passwordHash: await hashClinicPassword("Correcto-Cavalo-7"),
      role: "CLINIC_MANAGER",
      status: "ACTIVE",
      createdAt: NOW,
    });
    const inner = new InMemoryRateLimiter(clock, { namespace: "clinics" });
    const clinicRateLimiter = Object.assign(Object.create(inner) as InMemoryRateLimiter, {
      reset: (_key: RateLimitKey) => Promise.reject(new RateLimiterUnavailableError()),
    });
    const login = createClinicLoginUseCase({ ...fixtures.deps, clinicRateLimiter });
    const result = await login({ email: "gestor@clinica.pt", password: "Correcto-Cavalo-7" }, CONTEXT);
    expect(result.accessToken).toBeTruthy();
  });
});
