import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createSetDependentUseCase } from "./set-dependent.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

function seedAdmin(fixtures: ReturnType<typeof createFamiliesFixtures>): void {
  fixtures.membersRepo.seed({
    id: "admin1",
    familyId: FAMILY_ID,
    userId: "admin1",
    name: "Admin",
    birthDate: "1980-01-01",
    role: "FAMILY_ADMIN",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
}

describe("setDependent (UC-MEM-07)", () => {
  it("Admin marca adulto sem conta como dependente com tutor", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "profile1",
      familyId: FAMILY_ID,
      name: "Avô",
      birthDate: "1940-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const setDependent = createSetDependentUseCase(fixtures.deps);

    const result = await setDependent(
      "admin1",
      FAMILY_ID,
      "profile1",
      { isDependent: true, guardianMemberIds: ["admin1"] },
      CTX,
    );

    expect(result.isDependent).toBe(true);
    expect(result.primaryGuardianId).toBe("admin1");
  });

  it("adulto com conta marca-se a si próprio sem precisar de Admin (Q7)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "member1",
      familyId: FAMILY_ID,
      userId: "member1",
      name: "Membro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const setDependent = createSetDependentUseCase(fixtures.deps);

    const result = await setDependent(
      "member1",
      FAMILY_ID,
      "member1",
      { isDependent: true, guardianMemberIds: ["admin1"] },
      CTX,
    );
    expect(result.isDependent).toBe(true);
  });

  it("rejeita Admin a marcar dependente de outro adulto com conta (FORBIDDEN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "member1",
      familyId: FAMILY_ID,
      userId: "member1",
      name: "Membro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const setDependent = createSetDependentUseCase(fixtures.deps);

    await expect(
      setDependent("admin1", FAMILY_ID, "member1", { isDependent: true, guardianMemberIds: ["admin1"] }, CTX),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejeita desmarcar um menor como dependente (MINOR_MUST_BE_DEPENDENT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "child1",
      familyId: FAMILY_ID,
      name: "Criança",
      birthDate: "2015-01-01",
      isDependent: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const setDependent = createSetDependentUseCase(fixtures.deps);

    await expect(setDependent("admin1", FAMILY_ID, "child1", { isDependent: false }, CTX)).rejects.toMatchObject({
      code: "MINOR_MUST_BE_DEPENDENT",
    });
  });
});
