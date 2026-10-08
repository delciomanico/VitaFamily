import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createSetMemberRoleUseCase } from "./set-member-role.js";

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

describe("setMemberRole (UC-FAM-04)", () => {
  it("promove um membro adulto com conta a FAMILY_ADMIN", async () => {
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
    const setMemberRole = createSetMemberRoleUseCase(fixtures.deps);

    const result = await setMemberRole("admin1", FAMILY_ID, "member1", { role: "FAMILY_ADMIN" }, CTX);

    expect(result.role).toBe("FAMILY_ADMIN");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("MEMBER_ROLE_CHANGE");
  });

  it("rejeita retirar o papel ao último Admin (LAST_ADMIN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const setMemberRole = createSetMemberRoleUseCase(fixtures.deps);

    await expect(
      setMemberRole("admin1", FAMILY_ID, "admin1", { role: "FAMILY_MEMBER" }, CTX),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  it("rejeita dar papel a membro sem conta", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "profile1",
      familyId: FAMILY_ID,
      name: "Perfil",
      birthDate: "1990-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const setMemberRole = createSetMemberRoleUseCase(fixtures.deps);

    await expect(
      setMemberRole("admin1", FAMILY_ID, "profile1", { role: "FAMILY_MEMBER" }, CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
