import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAddGuardianUseCase } from "./add-guardian.js";
import { createFamiliesFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

function baseFixtures() {
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
    id: "guardian2",
    familyId: FAMILY_ID,
    userId: "guardian2",
    name: "Outro adulto",
    birthDate: "1985-01-01",
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

describe("addGuardian (UC-MEM-06)", () => {
  it("primeiro tutor torna-se principal automaticamente", async () => {
    const fixtures = baseFixtures();
    const addGuardian = createAddGuardianUseCase(fixtures.deps);

    const guardianship = await addGuardian("admin1", FAMILY_ID, "dep1", { guardianMemberId: "guardian2" }, CTX);

    expect(guardianship.isPrimary).toBe(true);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("GUARDIAN_ADD");
  });

  it("rejeita duplicado (CONFLICT)", async () => {
    const fixtures = baseFixtures();
    const addGuardian = createAddGuardianUseCase(fixtures.deps);
    await addGuardian("admin1", FAMILY_ID, "dep1", { guardianMemberId: "guardian2" }, CTX);

    await expect(
      addGuardian("admin1", FAMILY_ID, "dep1", { guardianMemberId: "guardian2" }, CTX),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejeita o próprio dependente como tutor (GUARDIAN_INVALID)", async () => {
    const fixtures = baseFixtures();
    const addGuardian = createAddGuardianUseCase(fixtures.deps);

    await expect(addGuardian("admin1", FAMILY_ID, "dep1", { guardianMemberId: "dep1" }, CTX)).rejects.toMatchObject(
      { code: "GUARDIAN_INVALID" },
    );
  });
});
