// Adaptador SMTP (Nodemailer) da porta `ShareMailer`: texto FIXO (BR-MKT-78), sem nome, rótulo, categorias, prazo nem ids.
import nodemailer from "nodemailer";
import type { ShareMailer } from "../application/maintenance.js";

export const SHARE_NOTICE_SUBJECT = "Vita Family — nova partilha de registos";
export const SHARE_NOTICE_TEXT = "Tem uma nova partilha de registos. Entre no portal do profissional para a ver.";

export class SmtpShareNoticeMailer implements ShareMailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendNewShareNotice(to: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: SHARE_NOTICE_SUBJECT, text: SHARE_NOTICE_TEXT });
  }
}
