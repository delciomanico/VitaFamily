import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import { createAccessFixtures } from "./fixtures.js";
import { createGetSharingUseCase } from "./get-sharing.js";
import { createAccessPolicy } from "./policy.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";

describe("getSharing (UC-PRV-01 leitura)", () => {
  it("o titular vê as suas concessões", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.sharingGrantsRepo.seed({ id: "g1", familyId: FAMILY_ID, ownerMemberId: "m1", category: "MEDICATION", createdAt: NOW });
    const policy = createAccessPolicy(fixtures.deps);
    const getSharing = createGetSharingUseCase(fixtures.deps, policy);

    const result = await getSharing({ userId: "u1", platformAdmin: false }, FAMILY_ID, "m1");

    expect(result).toEqual({ grants: [{ category: "MEDICATION" }] });
  });

  it("outro membro sem relação (OTHER) é recusado (FORBIDDEN)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
    const policy = createAccessPolicy(fixtures.deps);
    const getSharing = createGetSharingUseCase(fixtures.deps, policy);

    await expect(getSharing({ userId: "u2", platformAdmin: false }, FAMILY_ID, "m1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
