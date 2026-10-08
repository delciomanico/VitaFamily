import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ValidationError } from "../../../platform/errors/index.js";
import type { User } from "../domain/user.js";
import { createUsersFixtures } from "./fixtures.js";
import { createUpdateMeUseCase } from "./update-me.js";

const NOW = new Date("2026-10-08T10:00:00Z");

function seededUser(): User {
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
  };
}

describe("updateMe (UC-ACC-04)", () => {
  it("altera nome e fuso e audita USER_UPDATE", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock);
    fixtures.usersRepo.seed(seededUser());
    const updateMe = createUpdateMeUseCase(fixtures.deps);

    const result = await updateMe("u1", { name: "Ana Maria", timezone: "America/Sao_Paulo" }, {
      requestId: "req-1",
    });

    expect(result.name).toBe("Ana Maria");
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("USER_UPDATE");
  });

  it("rejeita fuso horário inválido", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock);
    fixtures.usersRepo.seed(seededUser());
    const updateMe = createUpdateMeUseCase(fixtures.deps);

    await expect(
      updateMe("u1", { timezone: "Not/AZone" }, { requestId: "req-1" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejeita nome vazio", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createUsersFixtures(clock);
    fixtures.usersRepo.seed(seededUser());
    const updateMe = createUpdateMeUseCase(fixtures.deps);

    await expect(updateMe("u1", { name: "   " }, { requestId: "req-1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
