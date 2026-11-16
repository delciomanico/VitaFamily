// Fake em memória da porta `ProfessionalMailer` (testes/ambiente sem SMTP).
import type { ProfessionalMailer, ProfessionalSentEmail } from "../application/ports.js";

export class ProfessionalFakeMailer implements ProfessionalMailer {
  readonly sent: ProfessionalSentEmail[] = [];

  async send(email: ProfessionalSentEmail): Promise<void> {
    this.sent.push(email);
    await Promise.resolve();
  }

  lastSentTo(to: string): ProfessionalSentEmail | undefined {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}
