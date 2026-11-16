// Adaptador SMTP (Nodemailer) da porta `ProfessionalMailer`.
import nodemailer from "nodemailer";
import type { ProfessionalMailer, ProfessionalSentEmail } from "../application/ports.js";

export class ProfessionalSmtpMailer implements ProfessionalMailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(email: ProfessionalSentEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }
}
