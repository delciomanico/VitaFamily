import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { DomainError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { createAccessFixtures } from "./fixtures.js";
import { createAccessPolicy } from "./policy.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";

describe("AccessPolicy.can (authorization.md §2/§3/§4)", () => {
  it("AC-PRV-01: outro membro (sem concessão) é negado a ler dados de saúde do titular", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "u2", platformAdmin: false, familyId: FAMILY_ID, action: "READ", subjectMemberId: "m1", category: "MEDICATION" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("AC-PRV-02: titular partilha MEDICATION com N; N lê mas não escreve; revogar tira acesso imediatamente", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
    fixtures.sharingGrantsRepo.seed({
      id: "g1",
      familyId: FAMILY_ID,
      ownerMemberId: "m1",
      granteeMemberId: "n1",
      category: "MEDICATION",
      createdAt: NOW,
    });
    const policy = createAccessPolicy(fixtures.deps);
    const canInput = { userId: "u2", platformAdmin: false, familyId: FAMILY_ID, subjectMemberId: "m1", category: "MEDICATION" as const };

    await expect(policy.can({}, { ...canInput, action: "READ" })).resolves.toMatchObject({ relation: "OTHER" });
    await expect(policy.can({}, { ...canInput, action: "UPDATE" })).rejects.toBeInstanceOf(ForbiddenError);

    fixtures.sharingGrantsRepo.rows.length = 0; // BR-PRV-04: retirar a partilha tem efeito imediato.
    await expect(policy.can({}, { ...canInput, action: "READ" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("AC-PRV-03: dependente com conta lê MEDICATION/APPOINTMENTS e confirma toma, mas não ALLERGIES/CONDITIONS/EXAMS nem edita", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "d1", familyId: FAMILY_ID, userId: "u3", name: "D", isDependent: true, status: "ACTIVE" });
    const policy = createAccessPolicy(fixtures.deps);
    const base = { userId: "u3", platformAdmin: false, familyId: FAMILY_ID, subjectMemberId: "d1" };

    await expect(policy.can({}, { ...base, action: "READ", category: "MEDICATION" })).resolves.toMatchObject({ relation: "DEPENDENT_SELF" });
    await expect(policy.can({}, { ...base, action: "READ", category: "APPOINTMENTS" })).resolves.toMatchObject({ relation: "DEPENDENT_SELF" });
    await expect(policy.can({}, { ...base, action: "CONFIRM_DOSE", category: "MEDICATION" })).resolves.toBeDefined();
    await expect(policy.can({}, { ...base, action: "READ", category: "ALLERGIES" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(policy.can({}, { ...base, action: "READ", category: "CONDITIONS" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(policy.can({}, { ...base, action: "READ", category: "EXAMS" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(policy.can({}, { ...base, action: "UPDATE", category: "MEDICATION" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("AC-PRV-04: Platform Admin nunca acede a dados de saúde", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "admin1", platformAdmin: true, familyId: FAMILY_ID, action: "READ", subjectMemberId: "m1", category: "MEDICATION" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("AC-ISO-01: utilizador sem FamilyMember na família do pedido recebe NOT_FOUND (nunca revela a família)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "stranger", platformAdmin: false, familyId: FAMILY_ID, action: "READ", subjectMemberId: "m1", category: "MEDICATION" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("tutor (TUTOR_OF) tem acesso total ao dependente", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "t1", familyId: FAMILY_ID, userId: "u1", name: "T", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "d1", familyId: FAMILY_ID, name: "D", isDependent: true, status: "ACTIVE" });
    fixtures.familiesPort.seedGuardianship("d1", "t1");
    const policy = createAccessPolicy(fixtures.deps);
    const base = { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, subjectMemberId: "d1" };

    await expect(policy.can({}, { ...base, action: "UPDATE", category: "ALLERGIES" })).resolves.toMatchObject({ relation: "TUTOR_OF" });
  });

  it("sujeito BLOCKED nega qualquer ação sobre ele", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "BLOCKED" });
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "READ", subjectMemberId: "m1", category: "MEDICATION" }),
    ).rejects.toMatchObject({ code: "MEMBER_BLOCKED" });
  });

  it("MANAGE_SHARING: SELF e tutor podem definir partilha; dependente e outro membro não", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "d1", familyId: FAMILY_ID, userId: "u2", name: "D", isDependent: true, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "t1", familyId: FAMILY_ID, userId: "u3", name: "T", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedGuardianship("d1", "t1");
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "MANAGE_SHARING", subjectMemberId: "m1" }),
    ).resolves.toMatchObject({ relation: "SELF" });
    await expect(
      policy.can({}, { userId: "u3", platformAdmin: false, familyId: FAMILY_ID, action: "MANAGE_SHARING", subjectMemberId: "d1" }),
    ).resolves.toMatchObject({ relation: "TUTOR_OF" });
    await expect(
      policy.can({}, { userId: "u2", platformAdmin: false, familyId: FAMILY_ID, action: "MANAGE_SHARING", subjectMemberId: "d1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("VIEW_SHARED_WITH_ME só exige pertença à família (qualquer FAM_MEMBER)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    const policy = createAccessPolicy(fixtures.deps);

    await expect(policy.can({}, { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "VIEW_SHARED_WITH_ME" })).resolves.toMatchObject({
      actor: { id: "m1" },
    });
  });

  it("ação sem subjectMemberId (fora de VIEW_SHARED_WITH_ME) é erro interno do chamador", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    const policy = createAccessPolicy(fixtures.deps);

    await expect(
      policy.can({}, { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "READ", category: "MEDICATION" }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
