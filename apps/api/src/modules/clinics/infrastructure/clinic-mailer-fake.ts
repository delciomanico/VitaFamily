// Fake em memória da porta `ClinicMailer` — para testes/ambiente local sem SMTP (ADR-020).
import type { ClinicMailer, ClinicSentEmail } from "../application/ports.js";

export class ClinicFakeMailer implements ClinicMailer {
  readonly sent: ClinicSentEmail[] = [];

  async send(email: ClinicSentEmail): Promise<void> {
    this.sent.push(email);
    await Promise.resolve();
  }

  lastSentTo(to: string): ClinicSentEmail | undefined {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}
