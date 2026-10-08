import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Invitation } from "../domain/invitation.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { hashOpaqueToken } from "../domain/token.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createFinalizeDependentAccountInvitationUseCase } from "./finalize-dependent-account-invitation.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const TOKEN = "raw-token-123";
const EMAIL = "dependente@example.com";
const NEW_USER_ID = "u-new";

function seedInvitation(
  fixtures: ReturnType<typeof createFamiliesFixtures>,
  overrides: Partial<Invitation> = {},
): void {
  fixtures.membersRepo.seed({
    id: "dep1",
    familyId: FAMILY_ID,
    name: "Dependente",
    birthDate: "2014-01-01",
    isDependent: true,
    status: "ACTIVE",
    createdAt: NOW,
  });
  fixtures.invitationsRepo.seed({
    id: "inv1",
    familyId: FAMILY_ID,
    email: EMAIL,
    type: "DEPENDENT_ACCOUNT",
    memberId: "dep1",
    tokenHash: hashOpaqueToken(TOKEN),
    status: "PENDING",
    expiresAt: computeExpiresAt(NOW),
    createdAt: NOW,
    ...overrides,
  });
}

describe("finalizeDependentAccountInvitation (UC-MEM-05/BR-MEM-13)", () => {
  it("liga o userId ao FamilyMember, marca o convite aceite e audita (sem role estrutural)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const finalize = createFinalizeDependentAccountInvitationUseCase(fixtures.deps);

    await finalize(
      {},
      { invitationId: "inv1", familyId: FAMILY_ID, memberId: "dep1", userId: NEW_USER_ID },
      CTX,
    );

    const member = fixtures.membersRepo.byId.get("dep1");
    expect(member?.userId).toBe(NEW_USER_ID);
    expect(member?.role).toBeUndefined();
    expect(member?.name).toBe("Dependente"); // BR-MEM-13: dados do perfil permanecem

    const invitation = fixtures.invitationsRepo.byId.get("inv1");
    expect(invitation?.status).toBe("ACCEPTED");
    expect(invitation?.acceptedBy).toBe(NEW_USER_ID);

    expect(fixtures.audit.events.map((e) => e.action)).toContain("INVITATION_ACCEPT");
    const event = fixtures.audit.events.find((e) => e.action === "INVITATION_ACCEPT");
    expect(event?.subjectMemberId).toBe("dep1");
    expect(event?.actorUserId).toBe(NEW_USER_ID);
  });

  it("rejeita convite inexistente (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    const finalize = createFinalizeDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      finalize({}, { invitationId: "missing", familyId: FAMILY_ID, memberId: "dep1", userId: NEW_USER_ID }, CTX),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite já aceite/revogado (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { status: "REVOKED" });
    const finalize = createFinalizeDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      finalize({}, { invitationId: "inv1", familyId: FAMILY_ID, memberId: "dep1", userId: NEW_USER_ID }, CTX),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite expirado entretanto e marca-o como tal (INVITATION_EXPIRED)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, {
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-09-24T00:00:00Z"),
    });
    const finalize = createFinalizeDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      finalize({}, { invitationId: "inv1", familyId: FAMILY_ID, memberId: "dep1", userId: NEW_USER_ID }, CTX),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(fixtures.invitationsRepo.byId.get("inv1")?.status).toBe("EXPIRED");
  });

  it("rejeita perfil que já ganhou conta entretanto (CONFLICT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    fixtures.membersRepo.seed({
      id: "dep1",
      familyId: FAMILY_ID,
      userId: "already-linked",
      name: "Dependente",
      birthDate: "2014-01-01",
      isDependent: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const finalize = createFinalizeDependentAccountInvitationUseCase(fixtures.deps);

    await expect(
      finalize({}, { invitationId: "inv1", familyId: FAMILY_ID, memberId: "dep1", userId: NEW_USER_ID }, CTX),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
