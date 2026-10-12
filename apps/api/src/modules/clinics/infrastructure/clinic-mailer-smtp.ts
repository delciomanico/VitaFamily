// Adaptador SMTP (Nodemailer) da porta `ClinicMailer` (application/ports.ts) — ADR-020: não
// importa `modules/auth` (duplicado de `auth/infrastructure/mailer-smtp.ts`).
import nodemailer from "nodemailer";
import type { ClinicMailer, ClinicSentEmail } from "../application/ports.js";

export class ClinicSmtpMailer implements ClinicMailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(email: ClinicSentEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }
}
