import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { hashOpaqueToken } from "../domain/token.js";
import { createAcceptInvitationUseCase } from "./accept-invitation.js";
import { createFamiliesFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const TOKEN = "raw-token-123";

function seedFamilyAndUser(fixtures: ReturnType<typeof createFamiliesFixtures>): void {
  fixtures.familiesRepo.seed({ id: FAMILY_ID, name: "Família Silva", createdBy: "admin1", createdAt: NOW });
  fixtures.usersPort.seed({ id: "u2", email: "convidado@example.com", name: "Convidado", birthDate: "1990-01-01" });
}

describe("acceptInvitation (UC-MEM-03)", () => {
  it("cria novo FamilyMember quando o convite não liga a perfil", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedFamilyAndUser(fixtures);
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: "convidado@example.com",
      type: "MEMBER",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const acceptInvitation = createAcceptInvitationUseCase(fixtures.deps);

    const member = await acceptInvitation("u2", TOKEN, CTX);

    expect(member.role).toBe("FAMILY_MEMBER");
    expect(member.hasAccount).toBe(true);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("INVITATION_ACCEPT");
  });

  it("liga a perfil existente quando a data de nascimento coincide (BR-MEM-13)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedFamilyAndUser(fixtures);
    fixtures.membersRepo.seed({
      id: "profile1",
      familyId: FAMILY_ID,
      name: "Perfil Antigo",
      birthDate: "1990-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: "convidado@example.com",
      type: "MEMBER",
      memberId: "profile1",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const acceptInvitation = createAcceptInvitationUseCase(fixtures.deps);

    const member = await acceptInvitation("u2", TOKEN, CTX);

    expect(member.id).toBe("profile1");
    expect(member.name).toBe("Perfil Antigo");
    expect(member.hasAccount).toBe(true);
  });

  it("rejeita data de nascimento diferente do perfil (BIRTHDATE_MISMATCH)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedFamilyAndUser(fixtures);
    fixtures.membersRepo.seed({
      id: "profile1",
      familyId: FAMILY_ID,
      name: "Perfil Antigo",
      birthDate: "1950-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: "convidado@example.com",
      type: "MEMBER",
      memberId: "profile1",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const acceptInvitation = createAcceptInvitationUseCase(fixtures.deps);

    await expect(acceptInvitation("u2", TOKEN, CTX)).rejects.toMatchObject({ code: "BIRTHDATE_MISMATCH" });
  });

  it("rejeita e-mail diferente do convidado (INVITATION_EMAIL_MISMATCH)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedFamilyAndUser(fixtures);
    fixtures.usersPort.seed({ id: "u3", email: "outro@example.com", name: "Outro", birthDate: "1990-01-01" });
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: "convidado@example.com",
      type: "MEMBER",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: computeExpiresAt(NOW),
      createdAt: NOW,
    });
    const acceptInvitation = createAcceptInvitationUseCase(fixtures.deps);

    await expect(acceptInvitation("u3", TOKEN, CTX)).rejects.toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
  });

  it("rejeita convite expirado (INVITATION_EXPIRED) e marca-o como tal", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedFamilyAndUser(fixtures);
    fixtures.invitationsRepo.seed({
      id: "inv1",
      familyId: FAMILY_ID,
      email: "convidado@example.com",
      type: "MEMBER",
      tokenHash: hashOpaqueToken(TOKEN),
      status: "PENDING",
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-09-24T00:00:00Z"),
    });
    const acceptInvitation = createAcceptInvitationUseCase(fixtures.deps);

    await expect(acceptInvitation("u2", TOKEN, CTX)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(fixtures.invitationsRepo.byId.get("inv1")?.status).toBe("EXPIRED");
  });
});
