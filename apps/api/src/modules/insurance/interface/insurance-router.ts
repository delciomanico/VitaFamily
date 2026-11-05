// Controllers HTTP do titular (openapi operationIds: listPartnerInsurers, listInsurancePolicies,
// createInsurancePolicy, getInsurancePolicy, updateInsurancePolicy, deleteInsurancePolicy,
// listReimbursementClaims, createReimbursementClaim, getReimbursementClaim, markReimbursementClaimPaid
// — tag "Insurance", ADR-021). Ator de User (bearerAuth); o portal da seguradora vive em
// `insurance-portal-router.ts` com outro ator.
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { PartnerInsurerView } from "../application/list-partner-insurers.js";
import type { InsurancePolicyInput, InsurancePolicyPatch } from "../application/insurance-policies.js";
import type { ActorIdentity, ReimbursementClaim, RequestContext } from "../application/ports.js";
import type { ReimbursementClaimInput } from "../application/reimbursement-claims.js";
import type { InsurancePolicyView } from "../application/support-holder.js";
import { toInsurancePolicyResponse, toPartnerInsurerResponse, toReimbursementClaimResponse } from "./dto.js";

export interface InsuranceController {
  listPartnerInsurers: (actor: ActorIdentity, familyId: string) => Promise<PartnerInsurerView[]>;
  listInsurancePolicies: (actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext) => Promise<InsurancePolicyView[]>;
  createInsurancePolicy: (actor: ActorIdentity, familyId: string, memberId: string, input: InsurancePolicyInput, context: RequestContext) => Promise<InsurancePolicyView>;
  getInsurancePolicy: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext) => Promise<InsurancePolicyView>;
  updateInsurancePolicy: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, input: InsurancePolicyPatch, context: RequestContext) => Promise<InsurancePolicyView>;
  deleteInsurancePolicy: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext) => Promise<void>;
  listReimbursementClaims: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext) => Promise<ReimbursementClaim[]>;
  createReimbursementClaim: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, input: ReimbursementClaimInput, context: RequestContext) => Promise<ReimbursementClaim>;
  getReimbursementClaim: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, claimId: string, context: RequestContext) => Promise<ReimbursementClaim>;
  markReimbursementClaimPaid: (actor: ActorIdentity, familyId: string, memberId: string, policyId: string, claimId: string, context: RequestContext) => Promise<ReimbursementClaim>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

const POLICIES = "/families/:familyId/members/:memberId/insurance-policies";

export function createInsuranceRouter(controller: InsuranceController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/insurers",
    asyncHandler(async (req, res) => {
      res.json((await controller.listPartnerInsurers(requireActor(), requireParam(req, "familyId"))).map(toPartnerInsurerResponse));
    }),
  );

  router.get(
    POLICIES,
    asyncHandler(async (req, res) => {
      const result = await controller.listInsurancePolicies(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), buildRequestContext(req));
      res.json(result.map(toInsurancePolicyResponse));
    }),
  );

  router.post(
    POLICIES,
    asyncHandler(async (req, res) => {
      const result = await controller.createInsurancePolicy(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), req.body as InsurancePolicyInput, buildRequestContext(req));
      res.status(201).json(toInsurancePolicyResponse(result));
    }),
  );

  router.get(
    `${POLICIES}/:policyId`,
    asyncHandler(async (req, res) => {
      const result = await controller.getInsurancePolicy(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), buildRequestContext(req));
      res.json(toInsurancePolicyResponse(result));
    }),
  );

  router.patch(
    `${POLICIES}/:policyId`,
    asyncHandler(async (req, res) => {
      const result = await controller.updateInsurancePolicy(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), req.body as InsurancePolicyPatch, buildRequestContext(req));
      res.json(toInsurancePolicyResponse(result));
    }),
  );

  router.delete(
    `${POLICIES}/:policyId`,
    asyncHandler(async (req, res) => {
      await controller.deleteInsurancePolicy(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    `${POLICIES}/:policyId/reimbursement-claims`,
    asyncHandler(async (req, res) => {
      const result = await controller.listReimbursementClaims(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), buildRequestContext(req));
      res.json(result.map(toReimbursementClaimResponse));
    }),
  );

  router.post(
    `${POLICIES}/:policyId/reimbursement-claims`,
    asyncHandler(async (req, res) => {
      const result = await controller.createReimbursementClaim(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), req.body as ReimbursementClaimInput, buildRequestContext(req));
      res.status(201).json(toReimbursementClaimResponse(result));
    }),
  );

  router.get(
    `${POLICIES}/:policyId/reimbursement-claims/:claimId`,
    asyncHandler(async (req, res) => {
      const result = await controller.getReimbursementClaim(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), requireParam(req, "claimId"), buildRequestContext(req));
      res.json(toReimbursementClaimResponse(result));
    }),
  );

  router.put(
    `${POLICIES}/:policyId/reimbursement-claims/:claimId/paid`,
    asyncHandler(async (req, res) => {
      const result = await controller.markReimbursementClaimPaid(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "policyId"), requireParam(req, "claimId"), buildRequestContext(req));
      res.json(toReimbursementClaimResponse(result));
    }),
  );

  return router;
}
