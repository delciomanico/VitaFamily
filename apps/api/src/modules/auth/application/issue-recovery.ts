// Emissão de tokens de recuperação/verificação + e-mail, partilhada por `forgot-password`,
// `resend-verification` e pela reposição de acesso do Platform Admin (BR-ADM-02). O token só sai
// por e-mail: nunca é devolvido a quem chama. A recuperação usa um código OTP de 6 dígitos (como a
// verificação de e-mail), sempre procurado no âmbito do utilizador do `email` — nunca global.
import { newId } from "../../../platform/ids/index.js";
import { generateVerificationCode, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps } from "./ports.js";
import { trySendMail } from "./send-mail.js";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

interface Recipient {
  id: string;
  email: string;
}

export async function issuePasswordReset<Trx>(deps: AuthDeps<Trx>, trx: Trx, user: Recipient, now: Date): Promise<void> {
  await deps.authTokenRepo.invalidateAllForUser(trx, user.id, "PASSWORD_RESET", now);
  const rawToken = generateVerificationCode();
  await deps.authTokenRepo.insert(trx, {
    id: newId(),
    userId: user.id,
    type: "PASSWORD_RESET",
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    createdAt: now,
  });
  await trySendMail(deps.mailer, deps.logger, {
    to: user.email,
    subject: "Recuperação de palavra-passe — Vita Family",
    text: `O seu código para definir uma nova palavra-passe é ${rawToken} (válido 1 hora). Introduza-o em ${deps.appBaseUrl}/reset-password. Se não pediu esta recuperação, ignore este e-mail e não partilhe o código.`,
  });
}

export async function issueEmailVerification<Trx>(deps: AuthDeps<Trx>, trx: Trx, user: Recipient, now: Date): Promise<void> {
  await deps.authTokenRepo.invalidateAllForUser(trx, user.id, "EMAIL_VERIFICATION", now);
  const code = generateVerificationCode();
  await deps.authTokenRepo.insert(trx, {
    id: newId(),
    userId: user.id,
    type: "EMAIL_VERIFICATION",
    tokenHash: hashOpaqueToken(code),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    createdAt: now,
  });
  await trySendMail(deps.mailer, deps.logger, {
    to: user.email,
    subject: "Verifique a sua conta Vita Family",
    text: `Para confirmar o seu e-mail, use este código: ${code} (válido 24 horas).`,
  });
}
