// Emissão de códigos OTP por e-mail (verificação 24 h; recuperação 1 h). O código só sai por e-mail, nunca é devolvido a quem chama.
import { newId } from "../../../platform/ids/index.js";
import { generateVerificationCode, hashOpaqueToken } from "../domain/token.js";
import type { ProfessionalsDeps } from "./ports.js";
import { trySendMail } from "./send-mail.js";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

interface Recipient {
  id: string;
  email: string;
}

export async function issueEmailVerification<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, account: Recipient, now: Date): Promise<void> {
  await deps.authTokenRepo.invalidateAllForAccount(trx, account.id, "EMAIL_VERIFICATION", now);
  const code = generateVerificationCode();
  await deps.authTokenRepo.insert(trx, {
    id: newId(),
    accountId: account.id,
    type: "EMAIL_VERIFICATION",
    tokenHash: hashOpaqueToken(code),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    createdAt: now,
  });
  await trySendMail(deps.mailer, deps.logger, {
    to: account.email,
    subject: "Verifique a sua conta de profissional — Vita Family",
    text: `Para confirmar o seu e-mail, use este código: ${code} (válido 24 horas). Se não pediu este registo, ignore este e-mail.`,
  });
}

export async function issuePasswordReset<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, account: Recipient, now: Date): Promise<void> {
  await deps.authTokenRepo.invalidateAllForAccount(trx, account.id, "PASSWORD_RESET", now);
  const code = generateVerificationCode();
  await deps.authTokenRepo.insert(trx, {
    id: newId(),
    accountId: account.id,
    type: "PASSWORD_RESET",
    tokenHash: hashOpaqueToken(code),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    createdAt: now,
  });
  await trySendMail(deps.mailer, deps.logger, {
    to: account.email,
    subject: "Recuperação de palavra-passe — Vita Family (profissionais)",
    text: `O seu código para definir uma nova palavra-passe é ${code} (válido 1 hora). Introduza-o em ${deps.appBaseUrl}/professional/reset-password. Se não pediu esta recuperação, ignore este e-mail e não partilhe o código.`,
  });
}
