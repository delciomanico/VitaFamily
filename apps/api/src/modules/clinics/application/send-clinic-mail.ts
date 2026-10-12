// Envio de e-mail "best effort" do portal da clínica (ADR-020: duplicado de
// `auth/application/send-mail.ts`) — uma falha do SMTP nunca deve derrubar o caso de uso que já
// gravou a conta/credencial; só regista aviso (nunca o conteúdo, só `subject`, nunca PII).
import type { Logger } from "../../../platform/logger/index.js";
import type { ClinicMailer, ClinicSentEmail } from "./ports.js";

export async function trySendClinicMail(mailer: ClinicMailer, logger: Logger, email: ClinicSentEmail): Promise<void> {
  try {
    await mailer.send(email);
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "clinic_mailer_send_failed");
  }
}
