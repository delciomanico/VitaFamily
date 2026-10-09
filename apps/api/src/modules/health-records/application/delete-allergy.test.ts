import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createDeleteAllergyUseCase } from "./delete-allergy.js";
import { createHealthRecordsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("deleteAllergy", () => {
  it("AC-HLT-01: remove e regista a auditoria", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.allergiesRepo.seed({ id: "a1", familyId: FAMILY_ID, memberId: MEMBER_ID, name: "Pólen", createdAt: NOW });
    const deleteAllergy = createDeleteAllergyUseCase(fixtures.deps);

    await deleteAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "a1", CTX);

    expect(fixtures.allergiesRepo.byId.has("a1")).toBe(false);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("ALLERGY_DELETE");
  });

  it("alergia inexistente (NOT_FOUND)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const deleteAllergy = createDeleteAllergyUseCase(fixtures.deps);

    await expect(deleteAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "missing", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("alergia de outro membro não é encontrada (isolamento)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.allergiesRepo.seed({ id: "a1", familyId: FAMILY_ID, memberId: "other-member", name: "Pólen", createdAt: NOW });
    const deleteAllergy = createDeleteAllergyUseCase(fixtures.deps);

    await expect(deleteAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "a1", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
