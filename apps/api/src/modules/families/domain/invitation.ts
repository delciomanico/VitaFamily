// Entidade pura `Invitation` (entities.md) e regras de validade (BR-MEM-12, R3, B4).
// Transições de estado: ver state-machines.md "Invitation" — modeladas aqui como função pura.

/** R3/BR-MEM-12: validade do convite. */
export const INVITATION_TTL_DAYS = 7;
/** BR-FAM-07/B4: máximo de convites pendentes por família. */
export const MAX_PENDING_INVITATIONS_PER_FAMILY = 20;

export type InvitationType = "MEMBER" | "DEPENDENT_ACCOUNT";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  familyId: string;
  email: string;
  type: InvitationType;
  memberId?: string;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  invitedBy?: string;
  acceptedBy?: string;
  acceptedAt?: Date;
  createdAt: Date;
}

/** `createdAt` + `INVITATION_TTL_DAYS` (R3). */
export function computeExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isExpired(invitation: Pick<Invitation, "expiresAt">, now: Date): boolean {
  return invitation.expiresAt.getTime() <= now.getTime();
}

/**
 * state-machines.md "Invitation": só `PENDING` transita; as restantes são finais. Devolve `false`
 * (nunca lança) — quem chama decide o código de erro (`INVITATION_INVALID`/`INVITATION_EXPIRED`).
 */
export function canTransition(from: InvitationStatus, to: InvitationStatus): boolean {
  if (from !== "PENDING") {
    return false;
  }
  return to === "ACCEPTED" || to === "REVOKED" || to === "EXPIRED";
}
