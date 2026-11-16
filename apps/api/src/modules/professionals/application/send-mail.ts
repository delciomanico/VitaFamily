// Envio de e-mail «best effort»: uma falha do SMTP não derruba o caso de uso que já gravou a conta/o código (recuperável por reenvio).
// Só se regista o assunto, nunca o conteúdo (tem o código) nem o destinatário (PII).
import type { Logger } from "../../../platform/logger/index.js";
import type { ProfessionalMailer, ProfessionalSentEmail } from "./ports.js";

export async function trySendMail(mailer: ProfessionalMailer, logger: Logger, email: ProfessionalSentEmail): Promise<void> {
  try {
    await mailer.send(email);
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "professional_mailer_send_failed");
  }
}
