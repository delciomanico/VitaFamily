// UC-ACC-01: registo de conta. Resposta sempre neutra (sem revelar se o e-mail já existe,
// AC-ACC-03); regista o e-mail de verificação (24 h). `invitationToken` (convite de conta de
// dependente, UC-MEM-05/BR-MEM-12/13/17) é resolvido através de `families` (modules.md §3.7):
// `auth` → `families`, unidirecional, na MESMA transação da criação do `User`.
import { newId } from "../../../platform/ids/index.js";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { assertPasswordPolicy } from "../domain/password.js";
import { hashPassword } from "../domain/password.js";
import {
  MIN_SELF_REGISTRATION_AGE,
  ageInYears,
  assertValidBirthDate,
  assertValidTimezone,
} from "../domain/registration-rules.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  birthDate: string;
  timezone: string;
  termsVersion: string;
  invitationToken?: string;
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTER_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };

export function createRegisterUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function register(input: RegisterInput, context: RequestContext): Promise<void> {
    const decision = deps.rateLimiter.consume(`register:ip:${context.ip ?? "unknown"}`, REGISTER_RATE_LIMIT);
    if (!decision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: decision.retryAfterMs });
    }

    const now = deps.clock.now();
    assertValidTimezone(input.timezone);
    assertPasswordPolicy(input.password);
    if (input.termsVersion !== deps.currentTermsVersion) {
      throw new ValidationError([{ field: "termsVersion", message: "não corresponde à versão atual" }], {
        detail: "Versão dos termos inválida.",
      });
    }

    const email = input.email.trim().toLowerCase();

    if (input.invitationToken !== undefined) {
      // UC-MEM-05/BR-MEM-17: ramo de "conta de dependente" — `MIN_SELF_REGISTRATION_AGE` (≥18) não
      // se aplica aqui; a idade mínima de dependente (B3, 13 anos) já foi verificada quando o
      // tutor criou o convite (families/create-dependent-account-invitation.ts). `input.birthDate`
      // é ignorado: a data de nascimento do `User` é a do perfil (BR-MEM-17), devolvida por
      // `resolveDependentAccountInvitation`. `input.name` continua a ser o nome da própria conta
      // (campo independente do nome do perfil, que fica como o tutor o definiu — BR-MEM-13; mesmo
      // padrão de `families/accept-invitation.ts` ao ligar um perfil existente).
      await registerDependentAccount(deps, input, input.invitationToken, email, now, context);
      return;
    }

    assertValidBirthDate(input.birthDate, now);
    const age = ageInYears(input.birthDate, now);
    if (age < MIN_SELF_REGISTRATION_AGE) {
      throw new DomainError("AGE_REQUIREMENT_NOT_MET", {
        detail: "O autorregisto exige 18 anos ou mais.",
      });
    }

    await deps.withTransaction(async (trx) => {
      const existing = await deps.usersPort.byEmail(trx, email);
      if (existing) {
        // AC-ACC-03: resposta neutra — não revela que a conta já existe, não envia e-mail.
        return;
      }

      const passwordHash = await hashPassword(input.password);
      const userId = newId();
      await deps.usersPort.createAccount(trx, {
        id: userId,
        email,
        passwordHash,
        name: input.name,
        birthDate: input.birthDate,
        timezone: input.timezone,
        termsAcceptedVersion: input.termsVersion,
        termsAcceptedAt: now,
        createdAt: now,
      });

      const rawToken = generateOpaqueToken();
      await deps.authTokenRepo.insert(trx, {
        id: newId(),
        userId,
        type: "EMAIL_VERIFICATION",
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
        createdAt: now,
      });

      await deps.mailer.send({
        to: email,
        subject: "Verifique a sua conta Vita Family",
        text: `Bem-vindo à Vita Family. Para confirmar o seu e-mail, use este código: ${rawToken} (válido 24 horas).`,
      });
    });
  };

  /**
   * UC-MEM-05: cria a conta de acesso limitado do dependente e liga-a ao `FamilyMember` do
   * convite, tudo na MESMA transação (modules.md §3.7). Decisão (não documentada literalmente em
   * `authentication.md`, por analogia com BR-ACC-01): a conta fica `ACTIVE` de imediato — o
   * `invitationToken` já prova a posse do e-mail convidado com a mesma garantia do token de
   * `EMAIL_VERIFICATION` (ambos são segredos de uso único enviados só para esse e-mail,
   * `resolveDependentAccountInvitation` exige `email === invitation.email`); exigir uma segunda
   * verificação seria redundante e adiaria sem motivo o acesso limitado do dependente (N2).
   */
  async function registerDependentAccount(
    authDeps: AuthDeps<Trx>,
    registerInput: RegisterInput,
    invitationToken: string,
    normalizedEmail: string,
    requestNow: Date,
    requestContext: RequestContext,
  ): Promise<void> {
    await authDeps.withTransaction(async (trx) => {
      const existing = await authDeps.usersPort.byEmail(trx, normalizedEmail);
      if (existing) {
        // AC-ACC-03: resposta neutra.
        return;
      }

      const resolved = await authDeps.families.resolveDependentAccountInvitation(
        trx,
        invitationToken,
        normalizedEmail,
      );

      const passwordHash = await hashPassword(registerInput.password);
      const userId = newId();
      await authDeps.usersPort.createAccount(trx, {
        id: userId,
        email: normalizedEmail,
        passwordHash,
        name: registerInput.name,
        birthDate: resolved.birthDate,
        timezone: registerInput.timezone,
        termsAcceptedVersion: registerInput.termsVersion,
        termsAcceptedAt: requestNow,
        createdAt: requestNow,
      });

      await authDeps.families.finalizeDependentAccountInvitation(
        trx,
        {
          invitationId: resolved.invitationId,
          familyId: resolved.familyId,
          memberId: resolved.memberId,
          userId,
        },
        requestContext,
      );

      await authDeps.usersPort.setEmailVerified(trx, userId, requestNow);
    });
  }
}
