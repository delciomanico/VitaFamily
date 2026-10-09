import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGetBloodTypeUseCase } from "./get-blood-type.js";
import { createHealthRecordsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("getBloodType (FR-HP-01)", () => {
  it("devolve UNKNOWN quando nunca foi definido", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const getBloodType = createGetBloodTypeUseCase(fixtures.deps);

    const bloodType = await getBloodType(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(bloodType).toBe("UNKNOWN");
  });

  it("devolve o valor guardado por families.getBloodType", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seed(MEMBER_ID, "O_NEG");
    const getBloodType = createGetBloodTypeUseCase(fixtures.deps);

    expect(await getBloodType(ACTOR, FAMILY_ID, MEMBER_ID, CTX)).toBe("O_NEG");
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "READ", category: "ALLERGIES" });
  });

  it("audita HEALTH_VIEW só quando quem lê não é o titular", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.relation = "TUTOR_OF";
    const getBloodType = createGetBloodTypeUseCase(fixtures.deps);

    await getBloodType(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(fixtures.audit.events[0]).toMatchObject({ action: "HEALTH_VIEW", resourceType: "BloodType" });
  });
});
