// Adaptador SMTP (Nodemailer) da porta `ProfessionalMailer` de `consultations`: texto FIXO (BR-MKT-63/65), sem conteúdo, nomes nem ids.
import nodemailer from "nodemailer";
import type { ProfessionalMailer } from "../application/ports.js";

export const NOTICE_SUBJECT = "Vita Family — tem uma atualização";
export const NOTICE_TEXT = "Tem uma atualização no Vita. Entre no portal do profissional para a ver.";

export class SmtpProfessionalNoticeMailer implements ProfessionalMailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendNotice(to: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: NOTICE_SUBJECT, text: NOTICE_TEXT });
  }
}
