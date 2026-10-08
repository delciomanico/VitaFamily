import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Invitation } from "../domain/invitation.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { hashOpaqueToken } from "../domain/token.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createResolveDependentAccountInvitationUseCase } from "./resolve-dependent-account-invitation.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const FAMILY_ID = "f1";
const TOKEN = "raw-token-123";
const EMAIL = "dependente@example.com";

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

describe("resolveDependentAccountInvitation (UC-MEM-05/BR-MEM-17)", () => {
  it("devolve a data de nascimento do perfil, não a submetida", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    const resolved = await resolve({}, TOKEN, EMAIL);

    expect(resolved).toEqual({
      invitationId: "inv1",
      familyId: FAMILY_ID,
      memberId: "dep1",
      birthDate: "2014-01-01",
    });
  });

  it("é insensível a maiúsculas/minúsculas no e-mail", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, "DEPENDENTE@EXAMPLE.COM")).resolves.toMatchObject({ memberId: "dep1" });
  });

  it("rejeita token de convite MEMBER (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: EMAIL,
      type: "MEMBER",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita token inexistente (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, "unknown-token", EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite expirado e marca-o como tal (INVITATION_EXPIRED)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { expiresAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-09-24T00:00:00Z") });
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(fixtures.invitationsRepo.byId.get("inv1")?.status).toBe("EXPIRED");
  });

  it("rejeita convite já aceite/revogado (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { status: "REVOKED" });
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita e-mail diferente do convidado (INVITATION_EMAIL_MISMATCH)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, "outro@example.com")).rejects.toMatchObject({
      code: "INVITATION_EMAIL_MISMATCH",
    });
  });

  it("rejeita perfil que já tem conta (CONFLICT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.membersRepo.seed({
      id: "dep1",
      familyId: FAMILY_ID,
      userId: "existing-user",
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
    });
    const resolve = createResolveDependentAccountInvitationUseCase(fixtures.deps);

    await expect(resolve({}, TOKEN, EMAIL)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
