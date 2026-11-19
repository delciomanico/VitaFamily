// Portas de persistência das avaliações verificadas (MK3 S10; BR-MKT-59/60/61/63). A avaliação NÃO tem família, membro nem utilizador:
// a autoria prova-se pela marcação (`bookingId`), que some com o membro. As consultas do admin e as públicas nunca selecionam colunas de
// `bookings` além do que a vista precisa.
import type { OfferMethod } from "./ports.js";

export interface ReviewRecord {
  id: string;
  bookingId: string | null;
  professionalId: string;
  specialtyId: string;
  method: OfferMethod;
  /** Primeiro dia do mês da consulta (`YYYY-MM-DD`, fuso `Africa/Luanda`). */
  consultedMonth: string;
  rating: number;
  comment: string | null;
  commentHiddenAt: Date | null;
  replyText: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ReviewReportReasonCode = "ABUSE" | "PERSONAL_DATA" | "OFF_TOPIC" | "OTHER";
export type ReviewReportDecision = "DISMISS" | "HIDE_COMMENT";

export interface ReviewReportRecord {
  id: string;
  reviewId: string;
  reason: ReviewReportReasonCode;
  note: string | null;
  status: "OPEN" | "DECIDED";
  decision: ReviewReportDecision | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** Denúncia com a avaliação e o profissional avaliado (só colunas de `reviews`). */
export interface ReviewReportRow {
  report: ReviewReportRecord;
  review: ReviewRecord;
}

export interface ReviewAggregateRow {
  professionalId: string;
  count: number;
  sum: number;
}

export interface ReviewRepository<Trx> {
  /** Avaliação da marcação (bloqueia a linha se `forUpdate`). */
  findByBooking(trx: Trx, bookingId: string, forUpdate: boolean): Promise<ReviewRecord | null>;
  insert(trx: Trx, record: ReviewRecord): Promise<void>;
  /** Edição de nota/comentário. Não reabre um comentário oculto pela moderação (`comment_hidden_at` mantém-se). */
  update(trx: Trx, id: string, change: { rating: number; comment: string | null; at: Date }): Promise<void>;
  /** Avaliações públicas (mais recentes primeiro); `after` = `(createdAt, id)` do último item da página anterior. */
  listForProfessional(trx: Trx, filter: { professionalId: string; specialtyId?: string; unanswered?: boolean; limit: number; after?: { createdAt: Date; id: string } }): Promise<{ review: ReviewRecord; reported: boolean }[]>;
  /** Avaliação de um profissional (bloqueia a linha se `forUpdate`); de outro profissional ou inexistente ⇒ `null`. */
  findOfProfessional(trx: Trx, professionalId: string, reviewId: string, forUpdate: boolean): Promise<{ review: ReviewRecord; reported: boolean } | null>;
  /** Resposta única: `false` se já havia resposta (UPDATE condicional). */
  setReply(trx: Trx, reviewId: string, text: string, at: Date): Promise<boolean>;
  summary(trx: Trx, professionalId: string, specialtyId?: string): Promise<{ count: number; sum: number }>;
  aggregateForSpecialty(trx: Trx, specialtyId: string): Promise<ReviewAggregateRow[]>;
  aggregateForProfessionals(trx: Trx, professionalIds: readonly string[]): Promise<ReviewAggregateRow[]>;
  findReportByReview(trx: Trx, reviewId: string): Promise<ReviewReportRecord | null>;
  /** `false` se já existia (UNIQUE `(review_id)`, concorrência). */
  insertReport(trx: Trx, report: ReviewReportRecord): Promise<boolean>;
  listReports(trx: Trx, filter: { status: "OPEN" | "DECIDED"; limit: number; after?: { createdAt: Date; id: string } }): Promise<ReviewReportRow[]>;
  findReport(trx: Trx, reportId: string, forUpdate: boolean): Promise<ReviewReportRow | null>;
  decideReport(trx: Trx, reportId: string, change: { decision: ReviewReportDecision; at: Date; decidedBy: string }): Promise<void>;
  hideComment(trx: Trx, reviewId: string, at: Date): Promise<void>;
}
