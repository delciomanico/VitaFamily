import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateAllergyUseCase } from "./create-allergy.js";
import { createHealthRecordsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("createAllergy (FR-HP-02/03)", () => {
  it("AC-HLT-01: cria a alergia e regista a auditoria com o autor", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const createAllergy = createCreateAllergyUseCase(fixtures.deps);

    const allergy = await createAllergy(ACTOR, FAMILY_ID, MEMBER_ID, { name: "  Amendoim  ", since: "2020-01-01" }, CTX);

    expect(allergy.name).toBe("Amendoim");
    expect(allergy.since).toBe("2020-01-01");
    expect(fixtures.policy.calls).toEqual([
      { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "CREATE", subjectMemberId: MEMBER_ID, category: "ALLERGIES" },
    ]);
    const event = fixtures.audit.events.find((e) => e.action === "ALLERGY_CREATE");
    expect(event).toMatchObject({ actorUserId: "u1", resourceId: allergy.id, familyId: FAMILY_ID, subjectMemberId: MEMBER_ID, result: "SUCCESS" });
  });

  it("rejeita nome vazio (VALIDATION_ERROR)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const createAllergy = createCreateAllergyUseCase(fixtures.deps);

    await expect(createAllergy(ACTOR, FAMILY_ID, MEMBER_ID, { name: "   " }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("propaga a negação de access.policy.can() (FORBIDDEN)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.denyWith = Object.assign(new Error("sem permissão"), { code: "FORBIDDEN" });
    const createAllergy = createCreateAllergyUseCase(fixtures.deps);

    await expect(createAllergy(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Pólen" }, CTX)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixtures.allergiesRepo.byId.size).toBe(0);
  });
});
