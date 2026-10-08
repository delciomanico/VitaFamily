import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateDependentAccountInvitationUseCase } from "./create-dependent-account-invitation.js";
import { createFamiliesFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

async function fixturesWithGuardianAndDependent(birthDate: string) {
  const fixtures = createFamiliesFixtures(new FixedClock(NOW));
  fixtures.membersRepo.seed({
    id: "guardian1",
    familyId: FAMILY_ID,
    userId: "guardian1",
    name: "Tutor",
    birthDate: "1980-01-01",
    role: "FAMILY_ADMIN",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
  fixtures.membersRepo.seed({
    id: "dep1",
    familyId: FAMILY_ID,
    name: "Dependente",
    birthDate,
    isDependent: true,
    status: "ACTIVE",
    createdAt: NOW,
  });
  await fixtures.guardianshipsRepo.insert(
    {},
    { familyId: FAMILY_ID, dependentId: "dep1", guardianId: "guardian1", isPrimary: true, createdAt: NOW },
  );
  return fixtures;
}

describe("createDependentAccountInvitation (UC-MEM-05/AC-MEM-05)", () => {
  it("rejeita dependente com menos de 13 anos (DEPENDENT_ACCOUNT_AGE)", async () => {
    const fixtures = await fixturesWithGuardianAndDependent("2018-01-01"); // 8 anos
    const createInvitation = createCreateDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      createInvitation("guardian1", FAMILY_ID, "dep1", { email: "dep@example.com" }, CTX),
    ).rejects.toMatchObject({ code: "DEPENDENT_ACCOUNT_AGE" });
  });

  it("cria convite DEPENDENT_ACCOUNT para dependente com 13+ anos", async () => {
    const fixtures = await fixturesWithGuardianAndDependent("2012-01-01"); // 14 anos
    const createInvitation = createCreateDependentAccountInvitationUseCase(fixtures.deps);

    const invitation = await createInvitation("guardian1", FAMILY_ID, "dep1", { email: "dep@example.com" }, CTX);

    expect(invitation.type).toBe("DEPENDENT_ACCOUNT");
    expect(invitation.memberId).toBe("dep1");
    expect(fixtures.mailer.sent).toHaveLength(1);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("DEPENDENT_ACCOUNT_INVITATION_CREATE");
  });

  it("rejeita quem não é tutor do dependente (FORBIDDEN)", async () => {
    const fixtures = await fixturesWithGuardianAndDependent("2012-01-01");
    fixtures.membersRepo.seed({
      id: "other1",
      familyId: FAMILY_ID,
      userId: "other1",
      name: "Outro",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const createInvitation = createCreateDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      createInvitation("other1", FAMILY_ID, "dep1", { email: "dep@example.com" }, CTX),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
