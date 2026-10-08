import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createRemoveGuardianUseCase } from "./remove-guardian.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

function fixturesWithTwoGuardians() {
  const fixtures = createFamiliesFixtures(new FixedClock(NOW));
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
  fixtures.membersRepo.seed({
    id: "g1",
    familyId: FAMILY_ID,
    userId: "g1",
    name: "Tutor 1",
    birthDate: "1980-01-01",
    role: "FAMILY_MEMBER",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
  fixtures.membersRepo.seed({
    id: "g2",
    familyId: FAMILY_ID,
    userId: "g2",
    name: "Tutor 2",
    birthDate: "1982-01-01",
    role: "FAMILY_MEMBER",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
  fixtures.membersRepo.seed({
    id: "dep1",
    familyId: FAMILY_ID,
    name: "Dependente",
    birthDate: "2015-01-01",
    isDependent: true,
    status: "ACTIVE",
    createdAt: NOW,
  });
  return fixtures;
}

describe("removeGuardian (BR-MEM-07/P8)", () => {
  it("promove outro tutor a principal ao remover o principal", async () => {
    const fixtures = fixturesWithTwoGuardians();
    await fixtures.guardianshipsRepo.insert({}, { familyId: FAMILY_ID, dependentId: "dep1", guardianId: "g1", isPrimary: true, createdAt: NOW });
    await fixtures.guardianshipsRepo.insert({}, { familyId: FAMILY_ID, dependentId: "dep1", guardianId: "g2", isPrimary: false, createdAt: NOW });
    const removeGuardian = createRemoveGuardianUseCase(fixtures.deps);

    await removeGuardian("admin1", FAMILY_ID, "dep1", "g1", CTX);

    const remaining = await fixtures.guardianshipsRepo.listByDependent({}, FAMILY_ID, "dep1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ guardianId: "g2", isPrimary: true });
  });

  it("rejeita remover o último tutor (LAST_GUARDIAN)", async () => {
    const fixtures = fixturesWithTwoGuardians();
    await fixtures.guardianshipsRepo.insert({}, { familyId: FAMILY_ID, dependentId: "dep1", guardianId: "g1", isPrimary: true, createdAt: NOW });
    const removeGuardian = createRemoveGuardianUseCase(fixtures.deps);

    await expect(removeGuardian("admin1", FAMILY_ID, "dep1", "g1", CTX)).rejects.toMatchObject({
      code: "LAST_GUARDIAN",
    });
  });
});
