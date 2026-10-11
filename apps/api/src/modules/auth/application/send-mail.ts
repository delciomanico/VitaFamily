// Envio de e-mail "best effort": uma falha do fornecedor SMTP (credenciais erradas, IP não
// autorizado, indisponibilidade) nunca deve derrubar o caso de uso que a chama com um 500
// genérico — o utilizador já tem o token/conta criados; o pior cenário é não receber o e-mail
// a tempo, recuperável por `resend-verification`/repetir o pedido. Registado como aviso (nunca
// o conteúdo do e-mail, só o `to` seria PII — por isso nem esse vai para o log).
import type { Logger } from "../../../platform/logger/index.js";
import type { Mailer, SentEmail } from "./ports.js";

export async function trySendMail(mailer: Mailer, logger: Logger, email: SentEmail): Promise<void> {
  try {
    await mailer.send(email);
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "mailer_send_failed");
  }
}
