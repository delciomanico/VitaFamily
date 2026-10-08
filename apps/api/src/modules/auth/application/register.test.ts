import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { createAuthFixtures } from "./fixtures.js";
import { createRegisterUseCase, type RegisterInput } from "./register.js";

const NOW = new Date("2026-10-08T10:00:00Z");

function baseInput(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    email: "ana@example.com",
    password: "Correcto-Cavalo-7",
    name: "Ana",
    birthDate: "1990-01-01",
    timezone: "Europe/Lisbon",
    termsVersion: "1.0.0",
    ...overrides,
  };
}

const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" };

describe("register (AC-ACC-01/02/03)", () => {
  it("cria a conta PENDING_VERIFICATION e envia o e-mail de verificação", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const register = createRegisterUseCase(fixtures.deps);

    await register(baseInput(), CONTEXT);

    const user = await fixtures.usersPort.byEmail({}, "ana@example.com");
    expect(user?.status).toBe("PENDING_VERIFICATION");
    expect(fixtures.mailer.sent).toHaveLength(1);
    expect(fixtures.mailer.sent[0]?.to).toBe("ana@example.com");
  });

  it("AC-ACC-02: <18 anos é recusado com AGE_REQUIREMENT_NOT_MET", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const register = createRegisterUseCase(fixtures.deps);

    await expect(register(baseInput({ birthDate: "2010-01-01" }), CONTEXT)).rejects.toSatisfy(
      (err: unknown) => err instanceof DomainError && err.code === "AGE_REQUIREMENT_NOT_MET",
    );
  });

  it("AC-ACC-03: e-mail já registado responde sem erro (neutro) e não duplica nem envia e-mail", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const register = createRegisterUseCase(fixtures.deps);

    await register(baseInput(), CONTEXT);
    expect(fixtures.mailer.sent).toHaveLength(1);

    await expect(register(baseInput({ name: "Outra Ana" }), CONTEXT)).resolves.toBeUndefined();
    // Nenhum novo e-mail enviado, e o registo original não foi alterado.
    expect(fixtures.mailer.sent).toHaveLength(1);
    const user = await fixtures.usersPort.byEmail({}, "ana@example.com");
    expect(user?.name).toBe("Ana");
  });

  it("rejeita palavra-passe fraca (PASSWORD_WEAK)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const register = createRegisterUseCase(fixtures.deps);

    await expect(register(baseInput({ password: "curta" }), CONTEXT)).rejects.toSatisfy(
      (err: unknown) => err instanceof DomainError && err.code === "PASSWORD_WEAK",
    );
  });

  describe("conta de dependente via invitationToken (UC-MEM-05/BR-MEM-17)", () => {
    function seedInvitation(fixtures: ReturnType<typeof createAuthFixtures>): void {
      fixtures.families.seed({
        token: "dep-token",
        invitationId: "inv1",
        familyId: "fam1",
        memberId: "dep1",
        email: "dependente@example.com",
        birthDate: "2014-03-20", // perfil: 12 anos em NOW — BR-MEM-17 ignora o birthDate submetido
        status: "PENDING",
      });
    }

    it("cria a conta já ACTIVE, com a data de nascimento do perfil, e finaliza o convite", async () => {
      const clock = new FixedClock(NOW);
      const fixtures = createAuthFixtures(clock);
      seedInvitation(fixtures);
      const register = createRegisterUseCase(fixtures.deps);

      await register(
        baseInput({
          email: "dependente@example.com",
          birthDate: "1990-01-01", // ignorado (BR-MEM-17): o perfil manda
          invitationToken: "dep-token",
        }),
        CONTEXT,
      );

      const user = await fixtures.usersPort.byEmail({}, "dependente@example.com");
      expect(user?.status).toBe("ACTIVE");
      expect(user?.birthDate).toBe("2014-03-20");
      expect(fixtures.mailer.sent).toHaveLength(0); // sem e-mail de EMAIL_VERIFICATION (decisão §3)

      expect(fixtures.families.finalized).toHaveLength(1);
      expect(fixtures.families.finalized[0]).toMatchObject({
        invitationId: "inv1",
        familyId: "fam1",
        memberId: "dep1",
        userId: user?.id,
      });
    });

    it("rejeita token inválido (INVITATION_INVALID)", async () => {
      const clock = new FixedClock(NOW);
      const fixtures = createAuthFixtures(clock);
      const register = createRegisterUseCase(fixtures.deps);

      await expect(
        register(baseInput({ email: "dependente@example.com", invitationToken: "desconhecido" }), CONTEXT),
      ).rejects.toSatisfy((err: unknown) => err instanceof DomainError && err.code === "INVITATION_INVALID");
    });

    it("rejeita e-mail diferente do convidado (INVITATION_EMAIL_MISMATCH)", async () => {
      const clock = new FixedClock(NOW);
      const fixtures = createAuthFixtures(clock);
      seedInvitation(fixtures);
      const register = createRegisterUseCase(fixtures.deps);

      await expect(
        register(baseInput({ email: "outro@example.com", invitationToken: "dep-token" }), CONTEXT),
      ).rejects.toSatisfy((err: unknown) => err instanceof DomainError && err.code === "INVITATION_EMAIL_MISMATCH");
    });

    it("AC-ACC-03: e-mail já registado responde neutro e não finaliza o convite", async () => {
      const clock = new FixedClock(NOW);
      const fixtures = createAuthFixtures(clock);
      seedInvitation(fixtures);
      fixtures.usersPort.seed({
        id: "existing",
        email: "dependente@example.com",
        passwordHash: "x",
        name: "Já existe",
        birthDate: "1990-01-01",
        timezone: "Europe/Lisbon",
        status: "ACTIVE",
        platformRole: "NONE",
        termsAcceptedVersion: "1.0.0",
        termsAcceptedAt: NOW,
        createdAt: NOW,
      });
      const register = createRegisterUseCase(fixtures.deps);

      await expect(
        register(baseInput({ email: "dependente@example.com", invitationToken: "dep-token" }), CONTEXT),
      ).resolves.toBeUndefined();
      expect(fixtures.families.finalized).toHaveLength(0);
    });

    it("não exige idade mínima de autorregisto (≥18) neste ramo", async () => {
      const clock = new FixedClock(NOW);
      const fixtures = createAuthFixtures(clock);
      seedInvitation(fixtures);
      const register = createRegisterUseCase(fixtures.deps);

      await expect(
        register(
          baseInput({ email: "dependente@example.com", birthDate: "2020-01-01", invitationToken: "dep-token" }),
          CONTEXT,
        ),
      ).resolves.toBeUndefined();
    });
  });

  it("aplica o limite de 5/hora por IP", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAuthFixtures(clock);
    const register = createRegisterUseCase(fixtures.deps);

    for (let i = 0; i < 5; i += 1) {
      await register(baseInput({ email: `pessoa${String(i)}@example.com` }), CONTEXT);
    }

    await expect(register(baseInput({ email: "mais-uma@example.com" }), CONTEXT)).rejects.toSatisfy(
      (err: unknown) => err instanceof DomainError && err.code === "RATE_LIMITED",
    );
  });
});
