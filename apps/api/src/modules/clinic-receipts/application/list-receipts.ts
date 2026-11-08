// Financeiro (UC-CLN-27, BR-CLN-37): lista por período + total do período INTEIRO (anulados não somam); leitura, não auditada.
// `from`/`to` = dias locais inclusivos em CLINIC_TIMEZONE (obrigatórios, `to ≥ from`, ≤ 366 dias); 60 pedidos/min por conta.
import { NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor, parsePageParams } from "../../../platform/page/index.js";
import { addDaysIso, diffDaysIso, isIsoDate, localMidnightUtc } from "../../../platform/time/index.js";
import type { ReceiptStatus } from "../domain/receipt.js";
import type { ClinicPortalActor, ClinicReceiptsDeps } from "./ports.js";
import { assertCanManageReceipts, toReceiptView, type ClinicReceiptView } from "./support.js";

export const RECEIPT_MAX_DAYS = 366;
export const RECEIPT_LIST_RATE = { max: 60, windowMs: 60_000 };

export interface ListReceiptsQuery {
  from?: unknown;
  to?: unknown;
  status?: unknown;
  limit?: string;
  cursor?: string;
}

export interface ClinicReceiptPageView {
  items: ClinicReceiptView[];
  nextCursor: string | null;
  summary: { issuedCount: number; issuedTotalMinor: number; voidedCount: number; currency: string };
}

/** Janela `[start, end)` em UTC dos dias locais `[from, to]` inclusivos. */
export function parseReceiptWindow(fromRaw: unknown, toRaw: unknown): { start: Date; end: Date } {
  if (!isIsoDate(fromRaw) || !isIsoDate(toRaw)) {
    throw new ValidationError([{ field: "from", message: "from/to têm de ser datas AAAA-MM-DD" }], { detail: "Janela inválida." });
  }
  if (toRaw < fromRaw) {
    throw new ValidationError([{ field: "to", message: "não pode ser anterior a from" }], { detail: "Janela inválida." });
  }
  if (diffDaysIso(fromRaw, toRaw) + 1 > RECEIPT_MAX_DAYS) {
    throw new ValidationError([{ field: "to", message: `janela máxima de ${String(RECEIPT_MAX_DAYS)} dias` }], { detail: "Janela demasiado grande." });
  }
  return { start: localMidnightUtc(fromRaw), end: localMidnightUtc(addDaysIso(toRaw, 1)) };
}

export function createListReceiptsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function listReceipts(actor: ClinicPortalActor, query: ListReceiptsQuery): Promise<ClinicReceiptPageView> {
    assertCanManageReceipts(actor);
    const decision = deps.listLimiter.consume(`clinic-receipts:${actor.clinicAccountId}`, RECEIPT_LIST_RATE);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs);
    }
    const window = parseReceiptWindow(query.from, query.to);
    const status: ReceiptStatus | undefined = query.status === undefined ? undefined : query.status === "ISSUED" || query.status === "VOIDED" ? query.status : undefined;
    if (query.status !== undefined && status === undefined) {
      throw new ValidationError([{ field: "status", message: "ISSUED | VOIDED" }], { detail: "Filtro inválido." });
    }
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const decoded = cursor ? decodeCursor(cursor) : undefined;
    if (decoded && Number.isNaN(new Date(decoded.createdAt).getTime())) {
      throw new ValidationError([{ field: "cursor", message: "inválido" }], { detail: "Cursor de paginação inválido." });
    }

    return deps.withTransaction(async (trx) => {
      const rows = await deps.receiptsRepo.list(
        trx,
        actor.clinicId,
        { from: window.start, to: window.end, ...(status ? { status } : {}), ...(decoded ? { after: { issuedAt: new Date(decoded.createdAt), id: decoded.id } } : {}) },
        limit + 1,
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const summary = await deps.receiptsRepo.summarize(trx, actor.clinicId, window.start, window.end);
      const available = await deps.receiptsRepo.availableToPatient(trx, page.map((r) => r.id));
      const currency = page[0]?.currency ?? (await deps.profile.get(trx, actor.clinicId)).currency;
      return {
        items: page.map((r) => toReceiptView(r, available.has(r.id))),
        nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.issuedAt.toISOString(), id: last.id }) : null,
        summary: { ...summary, currency },
      };
    });
  };
}

export function createGetReceiptUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function getReceipt(actor: ClinicPortalActor, receiptId: string): Promise<ClinicReceiptView> {
    assertCanManageReceipts(actor);
    return deps.withTransaction(async (trx) => {
      const receipt = await deps.receiptsRepo.findById(trx, actor.clinicId, receiptId);
      if (!receipt) {
        throw new NotFoundError({ detail: "Recibo não encontrado." });
      }
      const available = await deps.receiptsRepo.availableToPatient(trx, [receiptId]);
      return toReceiptView(receipt, available.has(receiptId));
    });
  };
}
