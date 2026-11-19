// Aviso GENÉRICO ao profissional (BR-MKT-65): enfileira-se DEPOIS do commit (o pg-boss não participa na transação Kysely) e é melhor esforço
// (falhar a fila nunca falha a operação; o contador do portal é a fonte de verdade). Nunca leva texto, nome, hora nem valor.
import type { ProfessionalNoticeEvent, ProfessionalNotices } from "./ports.js";

export async function sendProfessionalNotice(notices: ProfessionalNotices, input: { professionalId: string; bookingId: string; event: ProfessionalNoticeEvent }): Promise<void> {
  try {
    await notices.enqueue(input);
  } catch {
    // melhor esforço
  }
}
