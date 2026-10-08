// UC-MEM-02/D14/R3: convidar pessoa por e-mail (FAM_ADMIN). `memberId` liga o convite a um perfil
// sem conta existente (BR-MEM-13: os dados do perfil passam a ser do novo titular ao aceitar).
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { computeExpiresAt, MAX_PENDING_INVITATIONS_PER_FAMILY } from "../domain/invitation.js";
import { hasAccount } from "../domain/member.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireAdmin, requireMemberRecord, requireMembership } from "./membership.js";
import { toInvitationView, type InvitationView } from "./invitation-view.js";

export interface CreateInvitationInput {
  email: string;
  memberId?: string | null;
}

export function createCreateInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function createInvitation(
    userId: string,
    familyId: string,
    input: CreateInvitationInput,
    context: RequestContext,
  ): Promise<InvitationView> {
    const email = input.email.trim().toLowerCase();

    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(actor);

      const pending = await deps.invitationsRepo.countPending(trx, familyId);
      if (pending >= MAX_PENDING_INVITATIONS_PER_FAMILY) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de convites pendentes atingido." });
      }

      let memberId: string | undefined;
      if (input.memberId) {
        const target = await requireMemberRecord(deps, trx, familyId, input.memberId);
        if (hasAccount(target)) {
          throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
        }
        memberId = target.id;
      }

      const existingUser = await deps.usersPort.byEmail(trx, email);
      if (existingUser) {
        const alreadyMember = await deps.membersRepo.findByUserId(trx, familyId, existingUser.id);
        if (alreadyMember) {
          throw new DomainError("CONFLICT", { detail: "Essa pessoa já é membro da família." });
        }
      }

      const now = deps.clock.now();
      const rawToken = generateOpaqueToken();
      const invitation = await deps.invitationsRepo.insert(trx, {
        id: newId(),
        familyId,
        email,
        type: "MEMBER",
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: computeExpiresAt(now),
        invitedBy: userId,
        createdAt: now,
        ...(memberId !== undefined ? { memberId } : {}),
      });

      await deps.mailer.send({
        to: email,
        subject: "Convite para a Vita Family",
        text: `Foi convidado para uma família na Vita Family. Para aceitar, use este código: ${rawToken} (válido 7 dias). Abra ${deps.appBaseUrl}/convites/aceitar para continuar.`,
      });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "INVITATION_CREATE",
        resourceType: "Invitation",
        resourceId: invitation.id,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return toInvitationView(invitation);
    });
  };
}
