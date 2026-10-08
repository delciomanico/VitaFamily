import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError, ValidationError } from "../../../platform/errors/index.js";
import { createAccessFixtures } from "./fixtures.js";
import { createPutSharingUseCase } from "./put-sharing.js";
import { createAccessPolicy } from "./policy.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";
const CTX = { requestId: "req-1" };

function seedFamily(fixtures: ReturnType<typeof createAccessFixtures>): void {
  fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
  fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
}

describe("putSharing (UC-PRV-01 escrita, BR-PRV-01..04)", () => {
  it("o titular substitui as suas concessões e a mudança é auditada (SHARING_UPDATE)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    const result = await putSharing(
      { userId: "u1", platformAdmin: false },
      FAMILY_ID,
      "m1",
      { grants: [{ category: "MEDICATION", granteeMemberId: "n1" }, { category: "APPOINTMENTS" }] },
      CTX,
    );

    expect(result.grants).toEqual(
      expect.arrayContaining([
        { category: "MEDICATION", granteeMemberId: "n1" },
        { category: "APPOINTMENTS" },
      ]),
    );
    expect(fixtures.audit.events.map((e) => e.action)).toContain("SHARING_UPDATE");
  });

  it("substituir remove concessões anteriores não repetidas (BR-PRV-04: efeito imediato)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    fixtures.sharingGrantsRepo.seed({ id: "g0", familyId: FAMILY_ID, ownerMemberId: "m1", granteeMemberId: "n1", category: "ALLERGIES", createdAt: NOW });
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    const result = await putSharing({ userId: "u1", platformAdmin: false }, FAMILY_ID, "m1", { grants: [] }, CTX);

    expect(result.grants).toEqual([]);
  });

  it("não titular/tutor (OTHER) é recusado a definir partilha", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    await expect(
      putSharing({ userId: "u2", platformAdmin: false }, FAMILY_ID, "m1", { grants: [] }, CTX),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("granteeMemberId inexistente na família é VALIDATION_ERROR", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    await expect(
      putSharing({ userId: "u1", platformAdmin: false }, FAMILY_ID, "m1", { grants: [{ category: "MEDICATION", granteeMemberId: "missing" }] }, CTX),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("granteeMemberId igual ao próprio titular é VALIDATION_ERROR", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    await expect(
      putSharing({ userId: "u1", platformAdmin: false }, FAMILY_ID, "m1", { grants: [{ category: "MEDICATION", granteeMemberId: "m1" }] }, CTX),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("concessões duplicadas no pedido são VALIDATION_ERROR", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    seedFamily(fixtures);
    const policy = createAccessPolicy(fixtures.deps);
    const putSharing = createPutSharingUseCase(fixtures.deps, policy);

    await expect(
      putSharing(
        { userId: "u1", platformAdmin: false },
        FAMILY_ID,
        "m1",
        { grants: [{ category: "MEDICATION" }, { category: "MEDICATION" }] },
        CTX,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
