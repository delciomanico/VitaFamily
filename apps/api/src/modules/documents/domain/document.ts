// Entidade pura `Document` (entities.md DM7, schema.md §3) — sem I/O.
export type ResourceType = "PRESCRIPTION" | "EXAMINATION";
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
  createdAt: Date;
}
