import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError, ServiceUnavailableError } from "../../../platform/errors/index.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createLeaveFamilyUseCase } from "./leave-family.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

function seedAdmin(fixtures: ReturnType<typeof createFamiliesFixtures>, id: string): void {
  fixtures.membersRepo.seed({
    id,
    familyId: FAMILY_ID,
    userId: id,
    name: "Admin",
    birthDate: "1980-01-01",
    role: "FAMILY_ADMIN",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
}

describe("leaveFamily (UC-FAM-07/UC-MEM-09)", () => {
  it("DELETE remove o membro e audita FAMILY_LEAVE", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures, "admin1");
    fixtures.membersRepo.seed({
      id: "m2",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "Membro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const leaveFamily = createLeaveFamilyUseCase(fixtures.deps);

    const result = await leaveFamily("u2", FAMILY_ID, { dataChoice: "DELETE" }, CTX);

    expect(result).toEqual({ dataExportId: null });
    expect(await fixtures.membersRepo.findById({}, FAMILY_ID, "m2")).toBeNull();
    expect(fixtures.audit.events.map((e) => e.action)).toContain("FAMILY_LEAVE");
  });

  it("rejeita o último Admin (LAST_ADMIN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures, "admin1");
    fixtures.membersRepo.seed({
      id: "m2",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "Membro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const leaveFamily = createLeaveFamilyUseCase(fixtures.deps);

    await expect(leaveFamily("admin1", FAMILY_ID, { dataChoice: "DELETE" }, CTX)).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
  });

  it("rejeita o último tutor de um dependente (LAST_GUARDIAN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures, "admin1");
    fixtures.membersRepo.seed({
      id: "guardian1",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "Tutor",
      birthDate: "1990-01-01",
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
    await fixtures.guardianshipsRepo.insert({}, {
      familyId: FAMILY_ID,
      dependentId: "dep1",
      guardianId: "guardian1",
      isPrimary: true,
      createdAt: NOW,
    });
    const leaveFamily = createLeaveFamilyUseCase(fixtures.deps);

    await expect(leaveFamily("u2", FAMILY_ID, { dataChoice: "DELETE" }, CTX)).rejects.toMatchObject({
      code: "LAST_GUARDIAN",
    });
  });

  it("rejeita dependente com conta (P2)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures, "admin1");
    fixtures.membersRepo.seed({
      id: "dep1",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "Dependente",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const leaveFamily = createLeaveFamilyUseCase(fixtures.deps);

    await expect(leaveFamily("u2", FAMILY_ID, { dataChoice: "DELETE" }, CTX)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("TAKE devolve SERVICE_UNAVAILABLE (exportação é M9)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures, "admin1");
    fixtures.membersRepo.seed({
      id: "m2",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "Membro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const leaveFamily = createLeaveFamilyUseCase(fixtures.deps);

    await expect(leaveFamily("u2", FAMILY_ID, { dataChoice: "TAKE" }, CTX)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});
