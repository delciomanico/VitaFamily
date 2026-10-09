import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createHealthRecordsFixtures } from "./fixtures.js";
import { createListAllergiesUseCase } from "./list-allergies.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("listAllergies (audit.md §3: leitura só auditada quando não é o titular)", () => {
  it("não audita quando o titular lê os seus próprios dados (relation=SELF)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.allergiesRepo.seed({ id: "a1", familyId: FAMILY_ID, memberId: MEMBER_ID, name: "Pólen", createdAt: NOW });
    fixtures.policy.relation = "SELF";
    const listAllergies = createListAllergiesUseCase(fixtures.deps);

    const allergies = await listAllergies(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(allergies).toHaveLength(1);
    expect(fixtures.audit.events).toHaveLength(0);
  });

  it("audita HEALTH_VIEW quando quem lê não é o titular (relation=TUTOR_OF)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.relation = "TUTOR_OF";
    const listAllergies = createListAllergiesUseCase(fixtures.deps);

    await listAllergies(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(fixtures.audit.events).toHaveLength(1);
    expect(fixtures.audit.events[0]).toMatchObject({ action: "HEALTH_VIEW", resourceType: "Allergy", subjectMemberId: MEMBER_ID });
  });

  it("propaga DENY de access.policy.can() (ex.: MEMBER_BLOCKED)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.denyWith = Object.assign(new Error("bloqueado"), { code: "MEMBER_BLOCKED" });
    const listAllergies = createListAllergiesUseCase(fixtures.deps);

    await expect(listAllergies(ACTOR, FAMILY_ID, MEMBER_ID, CTX)).rejects.toMatchObject({ code: "MEMBER_BLOCKED" });
  });
});
