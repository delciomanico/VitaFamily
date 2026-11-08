// Lado família (UC-CLN-28, BR-CLN-35, authorization.md §6.5): o titular (`SELF`) ou tutor (`TUTOR_OF`) vê os recibos recebidos
// (só os que têm `clinic_receipt_links` para o membro). Decidido por `AccessPolicy.can(VIEW_CLINIC_RECEIPTS)`. Leitura, não auditada.
// A cópia do paciente nunca leva o motivo da anulação nem ids da clínica/conta.
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor, parsePageParams } from "../../../platform/page/index.js";
import { RECEIPT_NOTICE, type ClinicReceipt } from "../domain/receipt.js";
import type { ActorIdentity, ClinicReceiptsDeps } from "./ports.js";

export interface FamilyClinicReceiptView {
  id: string;
  number: number;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  status: ClinicReceipt["status"];
  paymentMethod: ClinicReceipt["paymentMethod"];
  currency: string;
  totalMinor: number;
  patientName: string;
  note: string | null;
  lines: { description: string; amountMinor: number }[];
  issuedAt: string;
  voidedAt: string | null;
  notice: string;
  attachedToClaimIds: string[];
}

export function toFamilyReceiptView(receipt: ClinicReceipt, attachedToClaimIds: string[]): FamilyClinicReceiptView {
  return {
    id: receipt.id,
    number: receipt.number,
    clinicName: receipt.issuer.name,
    clinicAddress: receipt.issuer.address ?? null,
    clinicPhone: receipt.issuer.phone ?? null,
    status: receipt.status,
    paymentMethod: receipt.paymentMethod,
    currency: receipt.currency,
    totalMinor: receipt.totalMinor,
    patientName: receipt.patientName,
    note: receipt.note,
    lines: receipt.lines.map((l) => ({ description: l.description, amountMinor: l.amountMinor })),
    issuedAt: receipt.issuedAt.toISOString(),
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    notice: RECEIPT_NOTICE,
    attachedToClaimIds,
  };
}

function authorize<Trx>(deps: ClinicReceiptsDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string) {
  return deps.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action: "VIEW_CLINIC_RECEIPTS", subjectMemberId: memberId });
}

export function createListFamilyReceiptsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function listFamilyReceipts(actor: ActorIdentity, familyId: string, memberId: string, query: { limit?: string; cursor?: string }): Promise<{ items: FamilyClinicReceiptView[]; nextCursor: string | null }> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const decoded = cursor ? decodeCursor(cursor) : undefined;
    if (decoded && Number.isNaN(new Date(decoded.createdAt).getTime())) {
      throw new ValidationError([{ field: "cursor", message: "inválido" }], { detail: "Cursor de paginação inválido." });
    }
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const rows = await deps.receiptsRepo.listLinkedByMember(trx, familyId, memberId, decoded ? { issuedAt: new Date(decoded.createdAt), id: decoded.id } : undefined, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const claims = await deps.attachedClaims.claimIdsByReceipt(trx, page.map((r) => r.id));
      return {
        items: page.map((r) => toFamilyReceiptView(r, claims.get(r.id) ?? [])),
        nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.issuedAt.toISOString(), id: last.id }) : null,
      };
    });
  };
}

export function createGetFamilyReceiptUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function getFamilyReceipt(actor: ActorIdentity, familyId: string, memberId: string, receiptId: string): Promise<FamilyClinicReceiptView> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const receipt = await deps.receiptsRepo.findLinkedByMember(trx, familyId, memberId, receiptId);
      if (!receipt) {
        throw new NotFoundError({ detail: "Recibo não encontrado." });
      }
      const claims = await deps.attachedClaims.claimIdsByReceipt(trx, [receiptId]);
      return toFamilyReceiptView(receipt, claims.get(receiptId) ?? []);
    });
  };
}
