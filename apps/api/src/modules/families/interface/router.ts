// Controllers HTTP de `/families*` e `/invitations/*` (openapi.yaml operationIds: createFamily,
// listFamilies, getFamily, updateFamily, deleteFamily, leaveFamily, listMembers, createMember,
// getMember, updateMember, removeMember, setMemberRole, setDependent, listGuardians, addGuardian,
// removeGuardian, setPrimaryGuardian, requestDependentExport, listInvitations, createInvitation,
// revokeInvitation, createDependentAccountInvitation, lookupInvitation, acceptInvitation).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { AddGuardianInput } from "../application/add-guardian.js";
import type { CreateDependentAccountInvitationInput } from "../application/create-dependent-account-invitation.js";
import type { CreateFamilyInput } from "../application/create-family.js";
import type { CreateInvitationInput } from "../application/create-invitation.js";
import type { CreateMemberInput } from "../application/create-member.js";
import type { FamilyView } from "../application/family-view.js";
import type { Guardianship } from "../domain/guardianship.js";
import type { InvitationView } from "../application/invitation-view.js";
import type { InvitationPreview } from "../application/lookup-invitation.js";
import type { LeaveFamilyInput, LeaveFamilyResult } from "../application/leave-family.js";
import type { MemberView } from "../application/member-view.js";
import type { SetDependentInput } from "../application/set-dependent.js";
import type { SetMemberRoleInput } from "../application/set-member-role.js";
import type { UpdateFamilyInput } from "../application/update-family.js";
import type { UpdateMemberInput } from "../application/update-member.js";
import {
  toFamilyResponse,
  toGuardianshipResponse,
  toInvitationPreviewResponse,
  toInvitationResponse,
  toLeaveFamilyResultResponse,
  toMemberResponse,
} from "./dto.js";

export interface FamiliesController {
  createFamily: (userId: string, input: CreateFamilyInput, ctx: RequestContext) => Promise<FamilyView>;
  listFamilies: (userId: string) => Promise<FamilyView[]>;
  getFamily: (userId: string, familyId: string) => Promise<FamilyView>;
  updateFamily: (userId: string, familyId: string, input: UpdateFamilyInput, ctx: RequestContext) => Promise<FamilyView>;
  deleteFamily: (userId: string, familyId: string, ctx: RequestContext) => Promise<void>;
  leaveFamily: (
    userId: string,
    familyId: string,
    input: LeaveFamilyInput,
    ctx: RequestContext,
  ) => Promise<LeaveFamilyResult>;

  listMembers: (userId: string, familyId: string) => Promise<MemberView[]>;
  createMember: (userId: string, familyId: string, input: CreateMemberInput, ctx: RequestContext) => Promise<MemberView>;
  getMember: (userId: string, familyId: string, memberId: string) => Promise<MemberView>;
  updateMember: (
    userId: string,
    familyId: string,
    memberId: string,
    input: UpdateMemberInput,
    ctx: RequestContext,
  ) => Promise<MemberView>;
  removeMember: (userId: string, familyId: string, memberId: string, ctx: RequestContext) => Promise<LeaveFamilyResult>;
  setMemberRole: (
    userId: string,
    familyId: string,
    memberId: string,
    input: SetMemberRoleInput,
    ctx: RequestContext,
  ) => Promise<MemberView>;
  setDependent: (
    userId: string,
    familyId: string,
    memberId: string,
    input: SetDependentInput,
    ctx: RequestContext,
  ) => Promise<MemberView>;

  listGuardians: (userId: string, familyId: string, memberId: string) => Promise<Guardianship[]>;
  addGuardian: (
    userId: string,
    familyId: string,
    memberId: string,
    input: AddGuardianInput,
    ctx: RequestContext,
  ) => Promise<Guardianship>;
  removeGuardian: (
    userId: string,
    familyId: string,
    memberId: string,
    guardianMemberId: string,
    ctx: RequestContext,
  ) => Promise<void>;
  setPrimaryGuardian: (
    userId: string,
    familyId: string,
    memberId: string,
    guardianMemberId: string,
    ctx: RequestContext,
  ) => Promise<void>;
  requestDependentExport: (userId: string, familyId: string, memberId: string) => Promise<never>;

  listInvitations: (userId: string, familyId: string) => Promise<InvitationView[]>;
  createInvitation: (
    userId: string,
    familyId: string,
    input: CreateInvitationInput,
    ctx: RequestContext,
  ) => Promise<InvitationView>;
  revokeInvitation: (userId: string, familyId: string, invitationId: string, ctx: RequestContext) => Promise<void>;
  createDependentAccountInvitation: (
    userId: string,
    familyId: string,
    memberId: string,
    input: CreateDependentAccountInvitationInput,
    ctx: RequestContext,
  ) => Promise<InvitationView>;
  lookupInvitation: (token: string, ctx: RequestContext) => Promise<InvitationPreview>;
  acceptInvitation: (userId: string, token: string, ctx: RequestContext) => Promise<MemberView>;
}

function requireActor(): { userId: string } {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return actor;
}

export function createFamiliesRouter(controller: FamiliesController): Router {
  const router = Router();

  router.post(
    "/families",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const family = await controller.createFamily(actor.userId, req.body as CreateFamilyInput, buildRequestContext(req));
      res.status(201).json(toFamilyResponse(family));
    }),
  );

  router.get(
    "/families",
    asyncHandler(async (_req, res) => {
      const actor = requireActor();
      const families = await controller.listFamilies(actor.userId);
      res.json(families.map(toFamilyResponse));
    }),
  );

  router.get(
    "/families/:familyId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const family = await controller.getFamily(actor.userId, requireParam(req, "familyId"));
      res.json(toFamilyResponse(family));
    }),
  );

  router.patch(
    "/families/:familyId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const family = await controller.updateFamily(
        actor.userId,
        requireParam(req, "familyId"),
        req.body as UpdateFamilyInput,
        buildRequestContext(req),
      );
      res.json(toFamilyResponse(family));
    }),
  );

  router.delete(
    "/families/:familyId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.deleteFamily(actor.userId, requireParam(req, "familyId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/families/:familyId/leave",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const result = await controller.leaveFamily(
        actor.userId,
        requireParam(req, "familyId"),
        req.body as LeaveFamilyInput,
        buildRequestContext(req),
      );
      res.status(202).json(toLeaveFamilyResultResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const members = await controller.listMembers(actor.userId, requireParam(req, "familyId"));
      res.json(members.map(toMemberResponse));
    }),
  );

  router.post(
    "/families/:familyId/members",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const member = await controller.createMember(
        actor.userId,
        requireParam(req, "familyId"),
        req.body as CreateMemberInput,
        buildRequestContext(req),
      );
      res.status(201).json(toMemberResponse(member));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const member = await controller.getMember(actor.userId, requireParam(req, "familyId"), requireParam(req, "memberId"));
      res.json(toMemberResponse(member));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const member = await controller.updateMember(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as UpdateMemberInput,
        buildRequestContext(req),
      );
      res.json(toMemberResponse(member));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const result = await controller.removeMember(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        buildRequestContext(req),
      );
      res.status(202).json(toLeaveFamilyResultResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/role",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const member = await controller.setMemberRole(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as SetMemberRoleInput,
        buildRequestContext(req),
      );
      res.json(toMemberResponse(member));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/dependent",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const member = await controller.setDependent(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as SetDependentInput,
        buildRequestContext(req),
      );
      res.json(toMemberResponse(member));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/guardians",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const guardians = await controller.listGuardians(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
      );
      res.json(guardians.map(toGuardianshipResponse));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/guardians",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const guardianship = await controller.addGuardian(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as AddGuardianInput,
        buildRequestContext(req),
      );
      res.status(201).json(toGuardianshipResponse(guardianship));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/guardians/:guardianMemberId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.removeGuardian(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "guardianMemberId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/guardians/primary",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as { guardianMemberId: string };
      await controller.setPrimaryGuardian(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        body.guardianMemberId,
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/exports",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.requestDependentExport(actor.userId, requireParam(req, "familyId"), requireParam(req, "memberId"));
      // `requestDependentExport` lança sempre (M9 ainda não implementado) — nunca chega aqui.
      res.status(202).end();
    }),
  );

  router.get(
    "/families/:familyId/invitations",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const invitations = await controller.listInvitations(actor.userId, requireParam(req, "familyId"));
      res.json(invitations.map(toInvitationResponse));
    }),
  );

  router.post(
    "/families/:familyId/invitations",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const invitation = await controller.createInvitation(
        actor.userId,
        requireParam(req, "familyId"),
        req.body as CreateInvitationInput,
        buildRequestContext(req),
      );
      res.status(201).json(toInvitationResponse(invitation));
    }),
  );

  router.delete(
    "/families/:familyId/invitations/:invitationId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.revokeInvitation(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "invitationId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/account-invitation",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const invitation = await controller.createDependentAccountInvitation(
        actor.userId,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateDependentAccountInvitationInput,
        buildRequestContext(req),
      );
      res.status(201).json(toInvitationResponse(invitation));
    }),
  );

  router.post(
    "/invitations/lookup",
    asyncHandler(async (req, res) => {
      const body = req.body as { token: string };
      const preview = await controller.lookupInvitation(body.token, buildRequestContext(req));
      res.json(toInvitationPreviewResponse(preview));
    }),
  );

  router.post(
    "/invitations/accept",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as { token: string };
      const member = await controller.acceptInvitation(actor.userId, body.token, buildRequestContext(req));
      res.json(toMemberResponse(member));
    }),
  );

  return router;
}
