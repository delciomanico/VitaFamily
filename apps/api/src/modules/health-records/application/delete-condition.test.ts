import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createDeleteConditionUseCase } from "./delete-condition.js";
import { createHealthRecordsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("deleteCondition", () => {
  it("AC-HLT-01: remove e regista a auditoria", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.conditionsRepo.seed({ id: "c1", familyId: FAMILY_ID, memberId: MEMBER_ID, name: "Asma", kind: "CONDITION", createdAt: NOW });
    const deleteCondition = createDeleteConditionUseCase(fixtures.deps);

    await deleteCondition(ACTOR, FAMILY_ID, MEMBER_ID, "c1", CTX);

    expect(fixtures.conditionsRepo.byId.has("c1")).toBe(false);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CONDITION_DELETE");
  });

  it("condição inexistente (NOT_FOUND)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const deleteCondition = createDeleteConditionUseCase(fixtures.deps);

    await expect(deleteCondition(ACTOR, FAMILY_ID, MEMBER_ID, "missing", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
