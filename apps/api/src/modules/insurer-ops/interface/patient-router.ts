// Controllers HTTP de `/families/{f}/members/{m}/insurance/*` (S6 parcial; openapi tag "Insurance", ADR-025, authorization.md §8.5).
// Ator `User` (bearerAuth; `getActor()`), nunca o `familyId`/`memberId` do caminho como identidade: a autorização é `AccessPolicy`.
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { CardClaimView, CardCoverageView, CardQrView, CardView } from "../application/patient-insurance.js";
import type { PatientActor, RequestContext } from "../application/ports.js";
import { toCardClaimResponse, toCardCoverageResponse, toCardQrResponse, toCardResponse } from "./dto.js";

export interface InsurerPatientController {
  listCardClaims: (actor: PatientActor, familyId: string, memberId: string) => Promise<CardClaimView[]>;
  claimCard: (actor: PatientActor, familyId: string, memberId: string, input: Record<string, unknown>, ctx: RequestContext) => Promise<CardClaimView>;
  revokeCardClaim: (actor: PatientActor, familyId: string, memberId: string, claimId: string, ctx: RequestContext) => Promise<void>;
  listCards: (actor: PatientActor, familyId: string, memberId: string) => Promise<CardView[]>;
  issueCardQr: (actor: PatientActor, familyId: string, memberId: string, beneficiaryId: string, ctx: RequestContext) => Promise<CardQrView>;
  getCardCoverage: (actor: PatientActor, familyId: string, memberId: string, beneficiaryId: string, ctx: RequestContext) => Promise<CardCoverageView>;
}

function requireActor(): PatientActor {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createInsurerPatientRouter(c: InsurerPatientController): Router {
  const router = Router();
  const base = "/families/:familyId/members/:memberId/insurance";
  // security.md «Cabeçalhos»: respostas com dados de terceiros/pessoais nunca ficam em cache (também as listas e GET por id).
  router.use(base, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const ids = (req: Parameters<typeof requireParam>[0]) => [requireParam(req, "familyId"), requireParam(req, "memberId")] as const;

  router.get(`${base}/card-claims`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    res.json((await c.listCardClaims(requireActor(), familyId, memberId)).map(toCardClaimResponse));
  }));
  router.post(`${base}/card-claims`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    res.status(201).json(toCardClaimResponse(await c.claimCard(requireActor(), familyId, memberId, (req.body ?? {}) as Record<string, unknown>, buildRequestContext(req))));
  }));
  router.delete(`${base}/card-claims/:claimId`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    await c.revokeCardClaim(requireActor(), familyId, memberId, requireParam(req, "claimId"), buildRequestContext(req));
    res.status(204).end();
  }));
  router.get(`${base}/cards`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    res.setHeader("Cache-Control", "no-store");
    res.json((await c.listCards(requireActor(), familyId, memberId)).map(toCardResponse));
  }));
  router.get(`${base}/cards/:beneficiaryId/qr`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(toCardQrResponse(await c.issueCardQr(requireActor(), familyId, memberId, requireParam(req, "beneficiaryId"), buildRequestContext(req))));
  }));
  router.get(`${base}/cards/:beneficiaryId/coverage`, asyncHandler(async (req, res) => {
    const [familyId, memberId] = ids(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(toCardCoverageResponse(await c.getCardCoverage(requireActor(), familyId, memberId, requireParam(req, "beneficiaryId"), buildRequestContext(req))));
  }));

  return router;
}
