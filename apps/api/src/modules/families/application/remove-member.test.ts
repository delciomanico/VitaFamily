import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ServiceUnavailableError } from "../../../platform/errors/index.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createRemoveMemberUseCase } from "./remove-member.js";

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

describe("removeMember (UC-MEM-08)", () => {
  it("remove de imediato um perfil sem conta", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "profile1",
      familyId: FAMILY_ID,
      name: "Avó",
      birthDate: "1950-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const removeMember = createRemoveMemberUseCase(fixtures.deps);

    const result = await removeMember("admin1", FAMILY_ID, "profile1", CTX);

    expect(result).toEqual({ dataExportId: null });
    expect(await fixtures.membersRepo.findById({}, FAMILY_ID, "profile1")).toBeNull();
    expect(fixtures.audit.events.map((e) => e.action)).toContain("MEMBER_REMOVE");
  });

  it("devolve SERVICE_UNAVAILABLE para membro com conta (BR-MEM-16, M9)", async () => {
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
    const removeMember = createRemoveMemberUseCase(fixtures.deps);

    await expect(removeMember("admin1", FAMILY_ID, "member1", CTX)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("rejeita remover o último Admin (LAST_ADMIN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const removeMember = createRemoveMemberUseCase(fixtures.deps);

    await expect(removeMember("admin1", FAMILY_ID, "admin1", CTX)).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
  });
});
