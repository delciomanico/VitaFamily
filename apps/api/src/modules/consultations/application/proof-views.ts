// Vista do comprovativo (openapi `PaymentProof`, BR-MKT-57/58). Só metadados: a chave do ficheiro nunca sai; nunca ids de utilizador.
import type { ProofRecord } from "./ports.js";

export interface ProofView {
  id: string;
  bookingId: string;
  status: string;
  scanStatus: string;
  contentType: string;
  sizeBytes: number;
  decisionReason: string | null;
  disputeNote: string | null;
  disputeDecision: string | null;
  decidedAt: string | null;
  disputedAt: string | null;
  purged: boolean;
  createdAt: string;
}

export function toProofView(p: ProofRecord): ProofView {
  return {
    id: p.id,
    bookingId: p.bookingId,
    status: p.status,
    scanStatus: p.scanStatus,
    contentType: p.contentType,
    sizeBytes: p.sizeBytes,
    decisionReason: p.decisionReason,
    disputeNote: p.disputeNote,
    disputeDecision: p.disputeDecision,
    decidedAt: p.decidedAt?.toISOString() ?? null,
    disputedAt: p.disputedAt?.toISOString() ?? null,
    purged: p.purgedAt !== null,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Descarregável só `CLEAN` e não purgado (BR-MKT-57: `INFECTED`/`PENDING`/purgado ⇒ `DOCUMENT_NOT_AVAILABLE`). */
export const isDownloadable = (p: ProofRecord): boolean => p.scanStatus === "CLEAN" && p.purgedAt === null;

export const PROOF_EXTENSION: Record<ProofRecord["contentType"], string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
