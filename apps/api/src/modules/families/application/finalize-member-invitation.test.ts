import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Invitation } from "../domain/invitation.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { MAX_MEMBERS_PER_FAMILY } from "../domain/member.js";
import { hashOpaqueToken } from "../domain/token.js";
import { createFamiliesFixtures } from "./fixtures.js";
import { createFinalizeMemberInvitationUseCase } from "./finalize-member-invitation.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const TOKEN = "raw-token-456";
const EMAIL = "convidado@example.com";
const NEW_USER_ID = "u-new";

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

describe("finalizeMemberInvitation (UC-MEM-03, change control)", () => {
  it("cria um FamilyMember novo quando o convite não estava ligado a um perfil", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures);
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await finalize(
      {},
      {
        invitationId: "inv2",
        familyId: FAMILY_ID,
        userId: NEW_USER_ID,
        userName: "Convidado",
        userBirthDate: "1990-01-01",
      },
      CTX,
    );

    const members = [...fixtures.membersRepo.byId.values()].filter((m) => m.familyId === FAMILY_ID);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      userId: NEW_USER_ID,
      name: "Convidado",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
    });

    const invitation = fixtures.invitationsRepo.byId.get("inv2");
    expect(invitation?.status).toBe("ACCEPTED");
    expect(invitation?.acceptedBy).toBe(NEW_USER_ID);

    const event = fixtures.audit.events.find((e) => e.action === "INVITATION_ACCEPT");
    expect(event?.actorUserId).toBe(NEW_USER_ID);
    expect(event?.subjectMemberId).toBe(members[0]?.id);
  });

  it("liga a conta a um perfil existente, preservando os dados do perfil (BR-MEM-13)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    fixtures.membersRepo.seed({
      id: "mem1",
      familyId: FAMILY_ID,
      name: "Perfil Antigo",
      birthDate: "1990-01-01",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    seedInvitation(fixtures, { memberId: "mem1" });
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await finalize(
      {},
      {
        invitationId: "inv2",
        familyId: FAMILY_ID,
        memberId: "mem1",
        userId: NEW_USER_ID,
        userName: "Convidado",
        userBirthDate: "1990-01-01",
      },
      CTX,
    );

    const member = fixtures.membersRepo.byId.get("mem1");
    expect(member?.userId).toBe(NEW_USER_ID);
    expect(member?.role).toBe("FAMILY_MEMBER");
    expect(member?.name).toBe("Perfil Antigo"); // BR-MEM-13: dados do perfil permanecem
  });

  it("rejeita quando a data de nascimento do User não coincide com a do perfil (BIRTHDATE_MISMATCH)", async () => {
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
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        {
          invitationId: "inv2",
          familyId: FAMILY_ID,
          memberId: "mem1",
          userId: NEW_USER_ID,
          userName: "Convidado",
          userBirthDate: "1991-01-01",
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "BIRTHDATE_MISMATCH" });
  });

  it("rejeita convite inexistente (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        { invitationId: "missing", familyId: FAMILY_ID, userId: NEW_USER_ID, userName: "X", userBirthDate: "1990-01-01" },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite já aceite/revogado (INVITATION_INVALID)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, { status: "REVOKED" });
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        { invitationId: "inv2", familyId: FAMILY_ID, userId: NEW_USER_ID, userName: "X", userBirthDate: "1990-01-01" },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejeita convite expirado entretanto e marca-o como tal (INVITATION_EXPIRED)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedInvitation(fixtures, {
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-09-24T00:00:00Z"),
    });
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        { invitationId: "inv2", familyId: FAMILY_ID, userId: NEW_USER_ID, userName: "X", userBirthDate: "1990-01-01" },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(fixtures.invitationsRepo.byId.get("inv2")?.status).toBe("EXPIRED");
  });

  it("rejeita perfil que já ganhou conta entretanto (CONFLICT)", async () => {
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
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        {
          invitationId: "inv2",
          familyId: FAMILY_ID,
          memberId: "mem1",
          userId: NEW_USER_ID,
          userName: "X",
          userBirthDate: "1990-01-01",
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejeita quando a família atingiu o limite de membros (LIMIT_EXCEEDED)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    for (let i = 0; i < MAX_MEMBERS_PER_FAMILY; i += 1) {
      fixtures.membersRepo.seed({
        id: `m${String(i)}`,
        familyId: FAMILY_ID,
        name: `Membro ${String(i)}`,
        birthDate: "1990-01-01",
        isDependent: false,
        status: "ACTIVE",
        createdAt: NOW,
      });
    }
    seedInvitation(fixtures);
    const finalize = createFinalizeMemberInvitationUseCase(fixtures.deps);

    await expect(
      finalize(
        {},
        { invitationId: "inv2", familyId: FAMILY_ID, userId: NEW_USER_ID, userName: "X", userBirthDate: "1990-01-01" },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});
