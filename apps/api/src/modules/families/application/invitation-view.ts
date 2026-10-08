// Vista `Invitation` (components.schemas.Invitation, openapi.yaml) — nunca expõe `tokenHash`
// (errors.md/NFR-SEC: o token só circula no corpo do pedido/e-mail, nunca na resposta da API).
import type { Invitation } from "../domain/invitation.js";

export interface InvitationView {
  id: string;
  familyId: string;
  email: string;
  type: Invitation["type"];
  status: Invitation["status"];
  expiresAt: Date;
  memberId?: string;
}

export function toInvitationView(invitation: Invitation): InvitationView {
  const view: InvitationView = {
    id: invitation.id,
    familyId: invitation.familyId,
    email: invitation.email,
    type: invitation.type,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
  if (invitation.memberId !== undefined) {
    view.memberId = invitation.memberId;
  }
  return view;
}
