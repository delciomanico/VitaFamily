import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { TtlCache } from "../domain/ttl-cache.js";
import { createAuthFixtures } from "./fixtures.js";
import { createResolveActorStateUseCase } from "./resolve-actor-state.js";
import type { User } from "../../users/index.js";

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
    termsAcceptedVersion: "1.0.0",
    termsAcceptedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe("resolveActorState (AC-ACC-04/06, cache ≤60 s)", () => {
  it("AC-ACC-04: reflete a conta suspensa", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    fixtures.usersPort.seed(seededUser({ status: "SUSPENDED" }));
    const cache = new TtlCache<{
      platformAdmin: boolean;
      suspended: boolean;
      termsReacceptanceRequired: boolean;
    }>(clock, 60_000);
    const resolveActorState = createResolveActorStateUseCase(fixtures.deps, cache);

    const state = await resolveActorState("u1", "s1");
    expect(state.suspended).toBe(true);
  });

  it("AC-ACC-06: assinala termsReacceptanceRequired quando a versão difere", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    fixtures.usersPort.seed(seededUser({ termsAcceptedVersion: "0.9.0" }));
    const cache = new TtlCache<{
      platformAdmin: boolean;
      suspended: boolean;
      termsReacceptanceRequired: boolean;
    }>(clock, 60_000);
    const resolveActorState = createResolveActorStateUseCase(fixtures.deps, cache);

    const state = await resolveActorState("u1", "s1");
    expect(state.termsReacceptanceRequired).toBe(true);
  });

  it("usa a cache (≤60 s): uma alteração direta no repositório não aparece até expirar", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    fixtures.usersPort.seed(seededUser());
    const cache = new TtlCache<{
      platformAdmin: boolean;
      suspended: boolean;
      termsReacceptanceRequired: boolean;
    }>(clock, 60_000);
    const resolveActorState = createResolveActorStateUseCase(fixtures.deps, cache);

    await resolveActorState("u1", "s1");
    fixtures.usersPort.seed(seededUser({ status: "SUSPENDED" }));
    const stillCached = await resolveActorState("u1", "s1");
    expect(stillCached.suspended).toBe(false);

    clock.advance(61_000);
    const afterExpiry = await resolveActorState("u1", "s1");
    expect(afterExpiry.suspended).toBe(true);
  });

  it("lança UNAUTHENTICATED se a conta já não existir", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const cache = new TtlCache<{
      platformAdmin: boolean;
      suspended: boolean;
      termsReacceptanceRequired: boolean;
    }>(clock, 60_000);
    const resolveActorState = createResolveActorStateUseCase(fixtures.deps, cache);

    await expect(resolveActorState("inexistente", "s1")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
