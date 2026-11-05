// Entidade pura `Document` (entities.md DM7, schema.md §3) — sem I/O.
/** ADR-021: `INSURANCE_POLICY` = foto do cartão da apólice (autoriza por `MANAGE_INSURANCE`, não por categoria). */
export type ResourceType = "PRESCRIPTION" | "EXAMINATION" | "INSURANCE_POLICY";
export type ScanStatus = "PENDING" | "CLEAN" | "INFECTED";

export interface Document {
  id: string;
  familyId: string;
  memberId: string;
  resourceType: ResourceType;
  resourceId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  scanStatus: ScanStatus;
  uploadedBy?: string;
  /** BR-CLN-08: marca PERMANENTE de PDF emitido pela clínica (só em exames); decide a visibilidade "só com o exame COMPLETED". */
  uploadedByClinic: boolean;
  /** Autor do PDF da clínica (rastreabilidade); pode ficar ausente se a conta for removida (SET NULL). Nunca com `uploadedBy`. */
  uploadedByClinicAccountId?: string;
  createdAt: Date;
}
