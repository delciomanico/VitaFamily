import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { User } from "../domain/user.js";
import { createGetMeUseCase } from "./get-me.js";
import { createUsersFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");

describe("getMe (AC-ACC-06)", () => {
  it("calcula termsReacceptanceRequired comparando com a versão atual", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock, "2.0.0");
    const user: User = {
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
    };
    fixtures.usersRepo.seed(user);
    const getMe = createGetMeUseCase(fixtures.deps);

    const result = await getMe("u1");
    expect(result.termsReacceptanceRequired).toBe(true);
  });

  it("lança NOT_FOUND se a conta não existir", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock);
    const getMe = createGetMeUseCase(fixtures.deps);

    await expect(getMe("inexistente")).rejects.toBeInstanceOf(NotFoundError);
  });
});
