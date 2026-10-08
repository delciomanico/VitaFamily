import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { MAX_FAMILIES_PER_USER } from "../domain/family.js";
import { createCreateFamilyUseCase } from "./create-family.js";
import { createFamiliesFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };

function seedUser(fixtures: ReturnType<typeof createFamiliesFixtures>, id = "u1"): void {
  fixtures.usersPort.seed({ id, email: "ana@example.com", name: "Ana", birthDate: "1990-01-01" });
}

describe("createFamily (UC-FAM-01)", () => {
  it("cria família e torna o utilizador FAMILY_ADMIN", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedUser(fixtures);
    const createFamily = createCreateFamilyUseCase(fixtures.deps);

    const family = await createFamily("u1", { name: "Família Silva" }, CTX);

    expect(family.name).toBe("Família Silva");
    expect(family.myRole).toBe("FAMILY_ADMIN");
    const members = await fixtures.membersRepo.listByFamily({}, family.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("FAMILY_ADMIN");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("FAMILY_CREATE");
  });

  it("rejeita nome vazio", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedUser(fixtures);
    const createFamily = createCreateFamilyUseCase(fixtures.deps);

    await expect(createFamily("u1", { name: "   " }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it(`rejeita acima de ${String(MAX_FAMILIES_PER_USER)} famílias (BR-FAM-07/B4)`, async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedUser(fixtures);
    const createFamily = createCreateFamilyUseCase(fixtures.deps);

    for (let i = 0; i < MAX_FAMILIES_PER_USER; i += 1) {
      await createFamily("u1", { name: `Família ${String(i)}` }, CTX);
    }

    const rejection = createFamily("u1", { name: "Mais uma" }, CTX);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});
