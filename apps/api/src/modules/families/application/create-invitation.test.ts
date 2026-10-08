import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { MAX_PENDING_INVITATIONS_PER_FAMILY } from "../domain/invitation.js";
import { createCreateInvitationUseCase } from "./create-invitation.js";
import { createFamiliesFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";

function seedAdmin(fixtures: ReturnType<typeof createFamiliesFixtures>): void {
  fixtures.membersRepo.seed({
    id: "admin1",
    familyId: FAMILY_ID,
    userId: "admin1",
    name: "Admin",
    birthDate: "1980-01-01",
    role: "FAMILY_ADMIN",
    isDependent: false,
    status: "ACTIVE",
    createdAt: NOW,
  });
}

describe("createInvitation (UC-MEM-02)", () => {
  it("cria convite válido 7 dias e envia e-mail", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createInvitation = createCreateInvitationUseCase(fixtures.deps);

    const invitation = await createInvitation("admin1", FAMILY_ID, { email: "nova@example.com" }, CTX);

    expect(invitation.status).toBe("PENDING");
    expect(invitation.expiresAt.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(fixtures.mailer.sent).toHaveLength(1);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("INVITATION_CREATE");
  });

  it("rejeita quando a pessoa já é membro (CONFLICT)", async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    fixtures.usersPort.seed({ id: "u2", email: "existe@example.com", name: "X", birthDate: "1990-01-01" });
    fixtures.membersRepo.seed({
      id: "m2",
      familyId: FAMILY_ID,
      userId: "u2",
      name: "X",
      birthDate: "1990-01-01",
      role: "FAMILY_MEMBER",
      isDependent: false,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const createInvitation = createCreateInvitationUseCase(fixtures.deps);

    await expect(
      createInvitation("admin1", FAMILY_ID, { email: "existe@example.com" }, CTX),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it(`rejeita acima de ${String(MAX_PENDING_INVITATIONS_PER_FAMILY)} convites pendentes (B4)`, async () => {
    const fixtures = createFamiliesFixtures(new FixedClock(NOW));
    seedAdmin(fixtures);
    const createInvitation = createCreateInvitationUseCase(fixtures.deps);
    for (let i = 0; i < MAX_PENDING_INVITATIONS_PER_FAMILY; i += 1) {
      await createInvitation("admin1", FAMILY_ID, { email: `convidado${String(i)}@example.com` }, CTX);
    }

    await expect(
      createInvitation("admin1", FAMILY_ID, { email: "mais-um@example.com" }, CTX),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});
