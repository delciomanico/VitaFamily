// Adaptador SMTP (Nodemailer) da porta `ProfessionalMailer` de `messaging`: texto FIXO (BR-MKT-41/46), sem conteúdo, nomes nem ids.
import nodemailer from "nodemailer";
import type { ProfessionalMailer } from "../application/ports.js";

export const NEW_MESSAGE_SUBJECT = "Vita Family — tem uma nova mensagem";
export const NEW_MESSAGE_TEXT = "Tem uma nova mensagem no Vita. Entre no portal do profissional para a ler.";

export class SmtpProfessionalMailer implements ProfessionalMailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendNewMessageNotice(to: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: NEW_MESSAGE_SUBJECT, text: NEW_MESSAGE_TEXT });
  }
}
