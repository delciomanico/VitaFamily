import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ValidationError } from "../../../platform/errors/index.js";
import type { User } from "../domain/user.js";
import { createAcceptTermsUseCase } from "./accept-terms.js";
import { createUsersFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");

function seededUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "ana@example.com",
    passwordHash: "hash",
    name: "Ana",
    birthDate: "1990-01-01",
    timezone: "Europe/Lisbon",
    status: "ACTIVE",
    platformRole: "NONE",
    termsAcceptedVersion: "0.9.0",
    termsAcceptedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe("acceptTerms (B6, AC-ACC-06)", () => {
  it("regista a aceitação da versão atual e audita USER_TERMS_ACCEPTED", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock, "1.0.0");
    fixtures.usersRepo.seed(seededUser());
    const acceptTerms = createAcceptTermsUseCase(fixtures.deps);

    await acceptTerms("u1", "1.0.0", { requestId: "req-1" });

    const user = await fixtures.usersRepo.findById({}, "u1");
    expect(user?.termsAcceptedVersion).toBe("1.0.0");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("USER_TERMS_ACCEPTED");
  });

  it("rejeita uma versão diferente da configurada", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock, "1.0.0");
    fixtures.usersRepo.seed(seededUser());
    const acceptTerms = createAcceptTermsUseCase(fixtures.deps);

    await expect(acceptTerms("u1", "0.5.0", { requestId: "req-1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
