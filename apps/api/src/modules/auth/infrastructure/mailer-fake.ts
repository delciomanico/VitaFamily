// Fake em memória da porta `Mailer` — para testes (e ambiente local sem SMTP, se necessário);
// CLAUDE.md M1 §4.
import type { Mailer, SentEmail } from "../application/ports.js";

export class FakeMailer implements Mailer {
  readonly sent: SentEmail[] = [];

  async send(email: SentEmail): Promise<void> {
    this.sent.push(email);
    await Promise.resolve();
  }

  lastSentTo(to: string): SentEmail | undefined {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}
