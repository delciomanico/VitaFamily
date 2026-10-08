import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateMemberUseCase } from "./create-member.js";
import { createFamiliesFixtures } from "./fixtures.js";

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

describe("createMember (UC-MEM-01)", () => {
  it("cria adulto sem conta e sem tutor (Q7)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createMember = createCreateMemberUseCase(fixtures.deps);

    const member = await createMember(
      "admin1",
      FAMILY_ID,
      { name: "Avó", birthDate: "1950-01-01", isDependent: false },
      CTX,
    );

    expect(member.hasAccount).toBe(false);
    expect(member.isDependent).toBe(false);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("MEMBER_CREATE");
  });

  it("cria dependente com tutor principal implícito", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createMember = createCreateMemberUseCase(fixtures.deps);

    const member = await createMember(
      "admin1",
      FAMILY_ID,
      { name: "Criança", birthDate: "2015-01-01", isDependent: true, guardianMemberIds: ["admin1"] },
      CTX,
    );

    expect(member.isDependent).toBe(true);
    expect(member.primaryGuardianId).toBe("admin1");
    expect(member.guardianIds).toEqual(["admin1"]);
  });

  it("rejeita menor sem marcar dependente (MINOR_MUST_BE_DEPENDENT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createMember = createCreateMemberUseCase(fixtures.deps);

    await expect(
      createMember("admin1", FAMILY_ID, { name: "Criança", birthDate: "2015-01-01", isDependent: false }, CTX),
    ).rejects.toMatchObject({ code: "MINOR_MUST_BE_DEPENDENT" });
  });

  it("rejeita dependente sem tutor (DEPENDENT_REQUIRES_GUARDIAN)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createMember = createCreateMemberUseCase(fixtures.deps);

    await expect(
      createMember("admin1", FAMILY_ID, { name: "Criança", birthDate: "2015-01-01", isDependent: true }, CTX),
    ).rejects.toMatchObject({ code: "DEPENDENT_REQUIRES_GUARDIAN" });
  });

  it("rejeita tutor inválido: sem conta (GUARDIAN_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.membersRepo.seed({
      id: "noacct1",
      familyId: FAMILY_ID,
      name: "Sem conta",
      birthDate: "1970-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const createMember = createCreateMemberUseCase(fixtures.deps);

    await expect(
      createMember(
        "admin1",
        FAMILY_ID,
        { name: "Criança", birthDate: "2015-01-01", isDependent: true, guardianMemberIds: ["noacct1"] },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "GUARDIAN_INVALID" });
  });

  it("rejeita quem não é Family Admin (FORBIDDEN)", async () => {
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
    const createMember = createCreateMemberUseCase(fixtures.deps);

    await expect(
      createMember("member1", FAMILY_ID, { name: "X", birthDate: "1990-01-01", isDependent: false }, CTX),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
