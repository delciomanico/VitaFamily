// Job `consultations.notify-professional` (BR-MKT-65): UM e-mail GENÉRICO ao profissional por evento (pedido de marcação, cancelamento pela
// família, comprovativo carregado, disputa aberta/decidida, nova avaliação). Idempotência na fila (`singletonKey` = marcação+evento); retry
// por falha de envio. O erro relança-se SEM causa nem destinatário (o e-mail nunca vai para logs). Profissional sem conta ⇒ descarta.
import type { ProfessionalContact, ProfessionalMailer } from "./ports.js";

export type NoticeResult = "SENT" | "SKIPPED";

export function createNotifyProfessional(deps: { contact: ProfessionalContact; mailer: ProfessionalMailer }) {
  return async function notifyProfessional(job: { professionalId: string }): Promise<NoticeResult> {
    const email = await deps.contact.getNotificationEmail(job.professionalId);
    if (!email) return "SKIPPED";
    try {
      await deps.mailer.sendNotice(email);
    } catch {
      throw new Error("professional_notice_failed");
    }
    return "SENT";
  };
}
