// Adaptador SMTP (Nodemailer) da porta `Mailer` (application/ports.ts) — mesma justificação de
// `auth/infrastructure/mailer-smtp.ts`: sem esperar pelo módulo `notifications` (M8); `families`
// não pode depender de `auth` (modules.md §2), por isso tem o seu próprio adaptador (~15 linhas).
import nodemailer from "nodemailer";
import type { Mailer, SentEmail } from "../application/ports.js";

export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(email: SentEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }
}
