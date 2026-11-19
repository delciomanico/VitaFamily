// Porta de persistência da MODERAÇÃO do admin (UC-MKT-24, BR-MKT-44). Separada de `ports.ts` para o admin não herdar as portas da família.
// Nunca devolve ids de família, membro nem `participantLabel`: só o que o admin pode ver (a denúncia, a mensagem e o profissional).
import type { Message } from "../domain/message.js";
import type { ReportDecision, ReportReason, ReportStatus } from "../domain/report.js";
import type { MessageReportRecord } from "./ports.js";

export interface ReportQueueRow {
  id: string;
  status: ReportStatus;
  reason: ReportReason;
  /** Lado que escreveu a mensagem denunciada. */
  reportedSide: "FAMILY" | "PROFESSIONAL";
  professionalId: string;
  createdAt: Date;
}

export interface ReportQueueFilter {
  status: ReportStatus;
  limit: number;
  /** Ordem `createdAt ASC, id ASC` (mais antiga primeiro): mantém só as que vêm DEPOIS. */
  after?: { createdAt: Date; id: string };
}

/** A denúncia com a mensagem denunciada e o profissional da conversa (a conversa/família/membro NÃO saem desta porta). */
export interface ReportWithMessage {
  report: MessageReportRecord & { decision: ReportDecision | null; decidedAt: Date | null };
  message: Message;
  professionalId: string;
}

export interface ModerationRepository<Trx> {
  listQueue(trx: Trx, filter: ReportQueueFilter): Promise<ReportQueueRow[]>;
  /** `forUpdate` bloqueia a linha da denúncia (decisões concorrentes serializam-se aqui). */
  findReport(trx: Trx, reportId: string, forUpdate: boolean): Promise<ReportWithMessage | null>;
  /** Oculta a mensagem (só acrescenta `hidden_at`; idempotente). */
  hideMessage(trx: Trx, messageId: string, at: Date): Promise<void>;
  /** Bloqueia a conversa e fecha-a com `closedBy = SYSTEM`, mesmo que já estivesse fechada por um lado (OP-91). */
  closeConversationBySystem(trx: Trx, conversationId: string, at: Date): Promise<void>;
  markDecided(trx: Trx, reportId: string, change: { decision: ReportDecision; decidedBy: string; at: Date }): Promise<void>;
}
