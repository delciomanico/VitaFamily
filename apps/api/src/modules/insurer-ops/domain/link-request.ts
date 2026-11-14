// Pedido de ligação cartão↔paciente (entities.md `BeneficiaryLinkRequest`, state-machines.md, BR-SEG-20). Visão da
// seguradora: nunca ids de utilizador/família/membro do paciente.
export type LinkRequestStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED";
export const LINK_REQUEST_STATUSES: LinkRequestStatus[] = ["PENDING", "CONFIRMED", "REJECTED", "REVOKED"];

export interface LinkRequest {
  id: string;
  insurerId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
  status: LinkRequestStatus;
  /** Data do pedido (`requestedAt` na API). */
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}

/** Dados do paciente guardados no pedido — só para a ligação e nunca expostos pela API da seguradora. */
export interface LinkRequestTarget {
  familyId: string;
  familyMemberId: string;
}
