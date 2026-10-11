import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Invitation } from "../domain/invitation.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { hashOpaqueToken } from "../domain/token.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createResolveMemberInvitationUseCase } from "./resolve-member-invitation.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";
const TOKEN = "raw-token-456";
const EMAIL = "convidado@example.com";

function seedInvitation(
  fixtures: ReturnType<typeof createFamiliesFixtures>,
  overrides: Partial<Invitation> = {},
): void {
  fixtures.invitationsRepo.seed({
    id: "inv2",
    familyId: FAMILY_ID,
    email: EMAIL,
    type: "MEMBER",
    tokenHash: hashOpaqueToken(TOKEN),
    status: "PENDING",
    expiresAt: computeExpiresAt(NOW),
    createdAt: NOW,
    ...overrides,
  });
}

describe("resolveMemberInvitation (UC-MEM-03, change control)", () => {
  it("devolve o convite sem memberId quando não ligado a nenhum perfil", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    const resolved = await resolve({}, TOKEN, EMAIL);

    expect(resolved).toEqual({ invitationId: "inv2", familyId: FAMILY_ID });
  });

  it("devolve o memberId quando ligado a um perfil sem conta", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.membersRepo.seed({
      id: "mem1",
      familyId: FAMILY_ID,
      name: "Perfil",
      birthDate: "1990-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    seedInvitation(fixtures, { memberId: "mem1" });
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).resolves.toEqual({
      invitationId: "inv2",
      familyId: FAMILY_ID,
      memberId: "mem1",
    });
  });

  it("é insensível a maiúsculas/minúsculas no e-mail", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, "CONVIDADO@EXAMPLE.COM")).resolves.toMatchObject({ invitationId: "inv2" });
  });

  it("rejeita token de convite DEPENDENT_ACCOUNT (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.invitationsRepo.seed({
      id: "inv2",
      familyId: FAMILY_ID,
      email: EMAIL,
      type: "DEPENDENT_ACCOUNT",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita token inexistente (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, "unknown-token", EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite expirado e marca-o como tal (INVITATION_EXPIRED)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { expiresAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-09-24T00:00:00Z") });
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(fixtures.invitationsRepo.byId.get("inv2")?.status).toBe("EXPIRED");
  });

  it("rejeita convite já aceite/revogado (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { status: "REVOKED" });
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita e-mail diferente do convidado (INVITATION_EMAIL_MISMATCH)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, "outro@example.com")).rejects.toMatchObject({
      code: "INVITATION_EMAIL_MISMATCH",
    });
  });

  it("rejeita perfil ligado que já tem conta (CONFLICT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.membersRepo.seed({
      id: "mem1",
      familyId: FAMILY_ID,
      userId: "already-linked",
      name: "Perfil",
      birthDate: "1990-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    seedInvitation(fixtures, { memberId: "mem1" });
    const resolve = createResolveMemberInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
