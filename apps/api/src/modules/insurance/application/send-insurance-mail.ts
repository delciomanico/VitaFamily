// Envio de e-mail "best effort" do portal da seguradora: uma falha do SMTP nunca derruba o caso de
// uso que já gravou a conta/credencial; só regista aviso (nunca o conteúdo, só `subject`).
import type { Logger } from "../../../platform/logger/index.js";
import type { InsuranceMailer, InsuranceSentEmail } from "./ports.js";

export async function trySendInsuranceMail(mailer: InsuranceMailer, logger: Logger, email: InsuranceSentEmail): Promise<void> {
  try {
    await mailer.send(email);
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "insurance_mailer_send_failed");
  }
}
