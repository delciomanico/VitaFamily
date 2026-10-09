import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createHealthRecordsFixtures } from "./fixtures.js";
import { createPutBloodTypeUseCase } from "./put-blood-type.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("putBloodType (FR-HP-01)", () => {
  it("AC-HLT-01: define o tipo sanguíneo e regista a auditoria com o autor", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const putBloodType = createPutBloodTypeUseCase(fixtures.deps);

    const bloodType = await putBloodType(ACTOR, FAMILY_ID, MEMBER_ID, { bloodType: "AB_POS" }, CTX);

    expect(bloodType).toBe("AB_POS");
    expect(fixtures.familiesPort.bloodTypes.get(MEMBER_ID)).toBe("AB_POS");
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "UPDATE", category: "ALLERGIES" });
    expect(fixtures.audit.events[0]).toMatchObject({ action: "BLOODTYPE_UPDATE", actorUserId: "u1", subjectMemberId: MEMBER_ID });
  });

  it("propaga a negação de access.policy.can()", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.denyWith = Object.assign(new Error("sem permissão"), { code: "FORBIDDEN" });
    const putBloodType = createPutBloodTypeUseCase(fixtures.deps);

    await expect(putBloodType(ACTOR, FAMILY_ID, MEMBER_ID, { bloodType: "O_POS" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixtures.familiesPort.bloodTypes.has(MEMBER_ID)).toBe(false);
  });
});
