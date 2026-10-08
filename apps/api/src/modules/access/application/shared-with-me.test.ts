import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAccessFixtures } from "./fixtures.js";
import { createAccessPolicy } from "./policy.js";
import { createSharedWithMeUseCase } from "./shared-with-me.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";

describe("sharedWithMe (UC-PRV-02)", () => {
  it("lista titulares e categorias partilhadas comigo, agrupadas por titular", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
    fixtures.sharingGrantsRepo.seed({ id: "g1", familyId: FAMILY_ID, ownerMemberId: "m1", granteeMemberId: "n1", category: "MEDICATION", createdAt: NOW });
    fixtures.sharingGrantsRepo.seed({ id: "g2", familyId: FAMILY_ID, ownerMemberId: "m1", granteeMemberId: "n1", category: "APPOINTMENTS", createdAt: NOW });
    const policy = createAccessPolicy(fixtures.deps);
    const sharedWithMe = createSharedWithMeUseCase(fixtures.deps, policy);

    const result = await sharedWithMe({ userId: "u2", platformAdmin: false }, FAMILY_ID);

    expect(result).toHaveLength(1);
    expect(result[0]?.memberId).toBe("m1");
    expect(result[0]?.memberName).toBe("M");
    expect([...(result[0]?.categories ?? [])].sort()).toEqual(["APPOINTMENTS", "MEDICATION"]);
  });

  it("inclui concessões para toda a família (granteeMemberId nulo)", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.familiesPort.seedMember({ id: "n1", familyId: FAMILY_ID, userId: "u2", name: "N", isDependent: false, status: "ACTIVE" });
    fixtures.sharingGrantsRepo.seed({ id: "g1", familyId: FAMILY_ID, ownerMemberId: "m1", category: "EXAMS", createdAt: NOW });
    const policy = createAccessPolicy(fixtures.deps);
    const sharedWithMe = createSharedWithMeUseCase(fixtures.deps, policy);

    const result = await sharedWithMe({ userId: "u2", platformAdmin: false }, FAMILY_ID);

    expect(result).toEqual([{ memberId: "m1", memberName: "M", categories: ["EXAMS"] }]);
  });

  it("nunca lista as próprias concessões como \"partilhadas comigo\"", async () => {
    const fixtures = createAccessFixtures(new FixedClock(NOW));
    fixtures.familiesPort.seedMember({ id: "m1", familyId: FAMILY_ID, userId: "u1", name: "M", isDependent: false, status: "ACTIVE" });
    fixtures.sharingGrantsRepo.seed({ id: "g1", familyId: FAMILY_ID, ownerMemberId: "m1", category: "EXAMS", createdAt: NOW });
    const policy = createAccessPolicy(fixtures.deps);
    const sharedWithMe = createSharedWithMeUseCase(fixtures.deps, policy);

    const result = await sharedWithMe({ userId: "u1", platformAdmin: false }, FAMILY_ID);

    expect(result).toEqual([]);
  });
});
