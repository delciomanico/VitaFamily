// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados).
// Fase 4b (ADR-021/ADR-023): apólices e pedidos de reembolso do titular, `GET /families/{id}/insurers` e
// `/insurance-portal/claims*` — conformidade de forma, estados/erros, isolamento entre seguradoras,
// minimização (a seguradora nunca recebe família/membro) e separação de tokens User/Insurance.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createInsuranceFixtures, createInsuranceHolderFixtures } from "../../src/modules/insurance/application/fixtures.js";
import {
  createCreateInsurancePolicyUseCase,
  createDeleteInsurancePolicyUseCase,
  createGetInsurancePolicyUseCase,
  createListInsurancePoliciesUseCase,
  createUpdateInsurancePolicyUseCase,
} from "../../src/modules/insurance/application/insurance-policies.js";
import { createListPartnerInsurersUseCase } from "../../src/modules/insurance/application/list-partner-insurers.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "../../src/modules/insurance/application/portal-claims.js";
import {
  createCreateReimbursementClaimUseCase,
  createGetReimbursementClaimUseCase,
  createListReimbursementClaimsUseCase,
  createMarkReimbursementClaimPaidUseCase,
} from "../../src/modules/insurance/application/reimbursement-claims.js";
import { createResolveInsuranceActorStateUseCase } from "../../src/modules/insurance/application/resolve-insurance-actor-state.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";
import { createInsuranceRouter } from "../../src/modules/insurance/interface/insurance-router.js";
import { createInsuranceActorContextMiddleware, createInsuranceBearerAuthSecurityHandler } from "../../src/modules/insurance/interface/insurance-portal-middleware.js";
import { createInsurancePortalRouter } from "../../src/modules/insurance/interface/insurance-portal-router.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-05T10:00:00.000Z");
const API = "/api/v1";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const USER = "11111111-1111-4111-8111-111111111111";
const FAMILY = "f0000000-0000-4000-8000-000000000001";
const MEMBER = "e0000000-0000-4000-8000-000000000001";
const INS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const INS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const AGT_A = "a2a2a2a2-0000-4000-8000-0000000000a2";
const ADM_A = "a1a1a1a1-0000-4000-8000-0000000000a1";
const AGT_B = "b2b2b2b2-0000-4000-8000-0000000000b2";
const SESSION = "cccccccc-0000-4000-8000-0000000000cc";
const DOC1 = "d1000000-0000-4000-8000-000000000001";
const DOC2 = "d2000000-0000-4000-8000-000000000002";
const DOC_PENDING = "d3000000-0000-4000-8000-000000000003";
const POLICIES = `${API}/families/${FAMILY}/members/${MEMBER}/insurance-policies`;

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const accounts = createInsuranceFixtures(clock);
  const holder = createInsuranceHolderFixtures(clock);
  for (const [id, name] of [[INS_A, "Seg A"], [INS_B, "Seg B"]] as const) {
    accounts.insurersRepo.seed({ id, name, taxId: `nif-${id}`, status: "ACTIVE", createdAt: NOW });
    holder.insurersRepo.seed({ id, name, taxId: `nif-${id}`, status: "ACTIVE", createdAt: NOW });
  }
  for (const [id, insurerId, role] of [[ADM_A, INS_A, "INSURANCE_ADMIN"], [AGT_A, INS_A, "INSURANCE_AGENT"], [AGT_B, INS_B, "INSURANCE_AGENT"]] as const) {
    accounts.insuranceAccountRepo.seed({ id, insurerId, email: `${id}@seg.pt`, passwordHash: "x", role, status: "ACTIVE", createdAt: NOW });
  }
  holder.membership.members.add(`${FAMILY}:${USER}`);
  holder.documents.seed(DOC1, { familyId: FAMILY, memberId: MEMBER });
  holder.documents.seed(DOC2, { familyId: FAMILY, memberId: MEMBER });
  holder.documents.seed(DOC_PENDING, { familyId: FAMILY, memberId: MEMBER, scanStatus: "PENDING" });

  const userActor: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: false }, () => {
      next();
    });
  };
  const insuranceActor = createInsuranceActorContextMiddleware({ resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(accounts.deps) });
  const app = createApp({
    openApiSpecPath: join(REPO_ROOT, "docs/05-api/openapi.yaml"),
    logger: createLogger({ level: "silent" }),
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      insuranceBearerAuth: createInsuranceBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware: (req: Request, res: Response, next: NextFunction) => {
      userActor(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        insuranceActor(req, res, next);
      });
    },
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(
        createInsuranceRouter({
          listPartnerInsurers: createListPartnerInsurersUseCase(holder.deps),
          listInsurancePolicies: createListInsurancePoliciesUseCase(holder.deps),
          createInsurancePolicy: createCreateInsurancePolicyUseCase(holder.deps),
          getInsurancePolicy: createGetInsurancePolicyUseCase(holder.deps),
          updateInsurancePolicy: createUpdateInsurancePolicyUseCase(holder.deps),
          deleteInsurancePolicy: createDeleteInsurancePolicyUseCase(holder.deps),
          listReimbursementClaims: createListReimbursementClaimsUseCase(holder.deps),
          createReimbursementClaim: createCreateReimbursementClaimUseCase(holder.deps),
          getReimbursementClaim: createGetReimbursementClaimUseCase(holder.deps),
          markReimbursementClaimPaid: createMarkReimbursementClaimPaidUseCase(holder.deps),
        }),
      );
      router.use(
        createInsurancePortalRouter(
          {
            insuranceLogin: () => Promise.reject(new Error("fora do âmbito")),
            insuranceRefresh: () => Promise.reject(new Error("fora do âmbito")),
            insuranceLogout: () => Promise.resolve(),
            listInsuranceAgents: () => Promise.resolve([]),
            createInsuranceAgent: () => Promise.reject(new Error("fora do âmbito")),
            removeInsuranceAgent: () => Promise.resolve(),
            listInsuranceClaims: createListInsuranceClaimsUseCase(holder.portalDeps),
            getInsuranceClaim: createGetInsuranceClaimUseCase(holder.portalDeps),
            decideInsuranceClaim: createDecideInsuranceClaimUseCase(holder.portalDeps),
          },
          "",
        ),
      );
    },
  });
  const userToken = `Bearer ${(await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const insToken = async (id: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: id, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  return { app, holder, userToken, insToken };
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;

const policyBody = (extra: object = {}) => ({ insurerName: "Seg A", policyNumber: "P-1", holderName: "Ana", ...extra });

async function createPolicy(h: Harness, extra: object = {}): Promise<string> {
  const res = await request(h.app).post(POLICIES).set("Authorization", h.userToken).send(policyBody(extra));
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe("GET /families/{id}/insurers", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("200 com [{id,name}] só das ACTIVE; sem NIF; 401 sem token; 404 se não for membro", async () => {
    h.holder.insurersRepo.setStatus(INS_B, "SUSPENDED");
    const res = await request(h.app).get(`${API}/families/${FAMILY}/insurers`).set("Authorization", h.userToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: INS_A, name: "Seg A" }]);
    expect((await request(h.app).get(`${API}/families/${FAMILY}/insurers`)).status).toBe(401);
    expect((await request(h.app).get(`${API}/families/f0000000-0000-4000-8000-000000000009/insurers`).set("Authorization", h.userToken)).status).toBe(404);
    expect((await request(h.app).get(`${API}/families/${FAMILY}/insurers`).set("Authorization", await h.insToken(AGT_A))).status).toBe(401);
  });
});

describe("apólices do titular", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("POST 201 com a forma do contrato; GET/lista/PATCH/DELETE; 404 depois de eliminada", async () => {
    const created = await request(h.app).post(POLICIES).set("Authorization", h.userToken).send(policyBody({ insurerId: INS_A, validUntil: "2027-01-31" }));
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: (created.body as { id: string }).id,
      insurerId: INS_A,
      insurerName: "Seg A",
      policyNumber: "P-1",
      holderName: "Ana",
      validUntil: "2027-01-31",
      cardDocumentId: null,
      createdAt: NOW.toISOString(),
    });
    const id = (created.body as { id: string }).id;

    expect((await request(h.app).get(POLICIES).set("Authorization", h.userToken)).body).toHaveLength(1);
    expect((await request(h.app).get(`${POLICIES}/${id}`).set("Authorization", h.userToken)).body).toMatchObject({ id });
    const patched = await request(h.app).patch(`${POLICIES}/${id}`).set("Authorization", h.userToken).send({ holderName: "Ana Silva", insurerId: null });
    expect(patched.body).toMatchObject({ holderName: "Ana Silva", insurerId: null });
    expect((await request(h.app).delete(`${POLICIES}/${id}`).set("Authorization", h.userToken)).status).toBe(204);
    expect((await request(h.app).get(`${POLICIES}/${id}`).set("Authorization", h.userToken)).status).toBe(404);
  });

  it("422/400 em corpo inválido; 422 VALIDATION_ERROR para seguradora suspensa/inexistente", async () => {
    expect([400, 422]).toContain((await request(h.app).post(POLICIES).set("Authorization", h.userToken).send({ insurerName: "x" })).status);
    h.holder.insurersRepo.setStatus(INS_B, "SUSPENDED");
    const res = await request(h.app).post(POLICIES).set("Authorization", h.userToken).send(policyBody({ insurerId: INS_B }));
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("OTHER ⇒ 403 FORBIDDEN; sem token ⇒ 401; token de seguradora ⇒ 401", async () => {
    h.holder.policy.relation = "OTHER";
    const res = await request(h.app).get(POLICIES).set("Authorization", h.userToken);
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe("FORBIDDEN");
    expect((await request(h.app).get(POLICIES)).status).toBe(401);
    expect((await request(h.app).get(POLICIES).set("Authorization", await h.insToken(AGT_A))).status).toBe(401);
  });

  it("DELETE com pedido ativo ⇒ 409 CONFLICT", async () => {
    const id = await createPolicy(h, { insurerId: INS_A });
    await request(h.app).post(`${POLICIES}/${id}/reimbursement-claims`).set("Authorization", h.userToken).send({ amount: 10, documentIds: [DOC1] });
    const res = await request(h.app).delete(`${POLICIES}/${id}`).set("Authorization", h.userToken);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("CONFLICT");
  });
});

describe("pedidos de reembolso: titular -> seguradora -> titular (estados SUBMITTED → APPROVED|REJECTED → PAID)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  const claimsUrl = (policyId: string) => `${POLICIES}/${policyId}/reimbursement-claims`;

  it("submete (201, forma do contrato, sem insurerId) e o titular lista/lê", async () => {
    const policyId = await createPolicy(h, { insurerId: INS_A });
    const res = await request(h.app).post(claimsUrl(policyId)).set("Authorization", h.userToken).send({ amount: 42.5, documentIds: [DOC1, DOC2] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: (res.body as { id: string }).id, policyId, amount: 42.5, currency: "EUR", status: "SUBMITTED", decisionNote: null, documentIds: [DOC1, DOC2], receipts: [], createdAt: NOW.toISOString() });
    const id = (res.body as { id: string }).id;
    expect((await request(h.app).get(claimsUrl(policyId)).set("Authorization", h.userToken)).body).toHaveLength(1);
    expect((await request(h.app).get(`${claimsUrl(policyId)}/${id}`).set("Authorization", h.userToken)).body).toMatchObject({ id, status: "SUBMITTED" });
  });

  it.each([
    ["sem documentos", { amount: 1, documentIds: [] }],
    ["mais de 10 documentos", { amount: 1, documentIds: Array.from({ length: 11 }, (_, i) => `d${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`) }],
    ["valor ≤ 0", { amount: 0, documentIds: [DOC1] }],
    ["documento em quarentena", { amount: 1, documentIds: [DOC_PENDING] }],
    ["documento inexistente", { amount: 1, documentIds: ["99999999-9999-4999-8999-999999999999"] }],
  ])("recusa: %s ⇒ 4xx de validação", async (_name, body) => {
    const policyId = await createPolicy(h, { insurerId: INS_A });
    const res = await request(h.app).post(claimsUrl(policyId)).set("Authorization", h.userToken).send(body);
    expect([400, 422]).toContain(res.status);
  });

  it("apólice sem parceira ⇒ 422 VALIDATION_ERROR; seguradora suspensa ⇒ 409 CONFLICT (AC-INS-01)", async () => {
    const free = await createPolicy(h);
    const noPartner = await request(h.app).post(claimsUrl(free)).set("Authorization", h.userToken).send({ amount: 1, documentIds: [DOC1] });
    expect(noPartner.status).toBe(422);
    expect((noPartner.body as { code: string }).code).toBe("VALIDATION_ERROR");

    const partner = await createPolicy(h, { insurerId: INS_A });
    h.holder.insurersRepo.setStatus(INS_A, "SUSPENDED");
    const suspended = await request(h.app).post(claimsUrl(partner)).set("Authorization", h.userToken).send({ amount: 1, documentIds: [DOC1] });
    expect(suspended.status).toBe(409);
    expect((suspended.body as { code: string }).code).toBe("CONFLICT");
  });

  it("portal: lista/abre só os da própria seguradora com o mínimo; decide; titular confirma PAID", async () => {
    const policyId = await createPolicy(h, { insurerId: INS_A });
    const created = await request(h.app).post(claimsUrl(policyId)).set("Authorization", h.userToken).send({ amount: 42.5, documentIds: [DOC1] });
    const claimId = (created.body as { id: string }).id;
    const agentA = await h.insToken(AGT_A);
    const agentB = await h.insToken(AGT_B);

    const list = await request(h.app).get(`${API}/insurance-portal/claims`).set("Authorization", agentA);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: claimId, status: "SUBMITTED", amount: 42.5, currency: "EUR", policyHolderName: "Ana", policyNumber: "P-1", decisionNote: null, documentIds: [DOC1], receipts: [] }]);
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(`${FAMILY}|${MEMBER}|policyId|insurerId`));
    expect((await request(h.app).get(`${API}/insurance-portal/claims`).set("Authorization", agentB)).body).toEqual([]);
    expect((await request(h.app).get(`${API}/insurance-portal/claims/${claimId}`).set("Authorization", agentB)).status).toBe(404);
    expect((await request(h.app).put(`${API}/insurance-portal/claims/${claimId}/decide`).set("Authorization", agentB).send({ decision: "APPROVE" })).status).toBe(404);
    expect((await request(h.app).get(`${API}/insurance-portal/claims/${claimId}`).set("Authorization", agentA)).body).toMatchObject({ id: claimId, documentIds: [DOC1] });

    // PAID antes de APPROVED ⇒ 409; REJECT sem motivo ⇒ 422; decisão desconhecida ⇒ 4xx.
    expect((await request(h.app).put(`${claimsUrl(policyId)}/${claimId}/paid`).set("Authorization", h.userToken)).status).toBe(409);
    expect((await request(h.app).put(`${API}/insurance-portal/claims/${claimId}/decide`).set("Authorization", agentA).send({ decision: "REJECT" })).status).toBe(422);
    expect([400, 422]).toContain((await request(h.app).put(`${API}/insurance-portal/claims/${claimId}/decide`).set("Authorization", agentA).send({ decision: "MAYBE" })).status);

    const approved = await request(h.app).put(`${API}/insurance-portal/claims/${claimId}/decide`).set("Authorization", agentA).send({ decision: "APPROVE", note: "Pago em 5 dias" });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ id: claimId, status: "APPROVED", decisionNote: "Pago em 5 dias" });
    const again = await request(h.app).put(`${API}/insurance-portal/claims/${claimId}/decide`).set("Authorization", await h.insToken(ADM_A)).send({ decision: "REJECT", note: "x" });
    expect(again.status).toBe(409);

    const paid = await request(h.app).put(`${claimsUrl(policyId)}/${claimId}/paid`).set("Authorization", h.userToken);
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: "PAID", decisionNote: "Pago em 5 dias" });
    expect((await request(h.app).put(`${claimsUrl(policyId)}/${claimId}/paid`).set("Authorization", h.userToken)).status).toBe(409);
  });

  it("token de User não é aceite no portal; sem token ⇒ 401; filtro status inválido ⇒ 4xx", async () => {
    expect((await request(h.app).get(`${API}/insurance-portal/claims`).set("Authorization", h.userToken)).status).toBe(401);
    expect((await request(h.app).get(`${API}/insurance-portal/claims`)).status).toBe(401);
    expect([400, 422]).toContain((await request(h.app).get(`${API}/insurance-portal/claims?status=XPTO`).set("Authorization", await h.insToken(AGT_A))).status);
  });
});
