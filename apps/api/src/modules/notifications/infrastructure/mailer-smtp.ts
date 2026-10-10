// Adaptador SMTP (Nodemailer) da porta `Mailer` (application/ports.ts) — mesmo critério de
// `auth`/`families` `infrastructure/mailer-smtp.ts` (módulos só se importam pela raiz; cada um
// com a sua própria instância, D6/D12).
import nodemailer from "nodemailer";
import type { Mailer } from "../application/ports.js";

export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text: body });
  }
}
