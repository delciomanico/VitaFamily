// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, sem BD; respostas também validadas):
// UC-ALR-06 addPushSubscription / deletePushSubscription — registo, "endpoint repetido atualiza", isolamento por utilizador (IDOR).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createAddPushSubscriptionUseCase } from "../../src/modules/notifications/application/add-push-subscription.js";
import { createDeletePushSubscriptionUseCase } from "../../src/modules/notifications/application/delete-push-subscription.js";
import { createNotificationsFixtures } from "../../src/modules/notifications/application/fixtures.js";
import { createGetPreferencesUseCase } from "../../src/modules/notifications/application/get-preferences.js";
import { createPutPreferencesUseCase } from "../../src/modules/notifications/application/put-preferences.js";
import { createNotificationsRouter } from "../../src/modules/notifications/interface/router.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { openApiSpecPath } from "../support/openapi-spec.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-10-12T10:00:00.000Z");
const USER_A = "77777777-7777-4777-8777-777777777777";
const USER_B = "66666666-6666-4666-8666-666666666666";
const SESSION = "88888888-8888-4888-8888-888888888888";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
const SUBSCRIPTIONS = `${API}/users/me/push-subscriptions`;
const body = (endpoint = "https://push.example/a") => ({ endpoint, p256dh: "BKEY", auth: "AUTH", userAgent: "Mozilla/5.0" });

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createNotificationsFixtures(clock);
  const actorContextMiddleware: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: false }, () => {
      next();
    });
  };
  const app = createApp({
    openApiSpecPath: openApiSpecPath(REPO_ROOT),
    logger: createLogger({ level: "silent" }),
    validateResponses: true,
    securityHandlers: { bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }) },
    actorContextMiddleware,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(
        createNotificationsRouter({
          getPreferences: createGetPreferencesUseCase(fx.deps),
          putPreferences: createPutPreferencesUseCase(fx.deps),
          addPushSubscription: createAddPushSubscriptionUseCase(fx.deps),
          deletePushSubscription: createDeletePushSubscriptionUseCase(fx.deps),
        }),
      );
    },
  });
  const tokenFor = async (userId: string) => `Bearer ${(await signAccessToken({ subject: { userId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  return { app, fx, a: await tokenFor(USER_A), b: await tokenFor(USER_B) };
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;

describe("push-subscriptions (UC-ALR-06)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("401 sem sessão", async () => {
    expect((await request(h.app).post(SUBSCRIPTIONS).send(body())).status).toBe(401);
    expect((await request(h.app).delete(`${SUBSCRIPTIONS}/${USER_A}`)).status).toBe(401);
  });

  it("422 com corpo inválido (sem chaves)", async () => {
    const res = await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send({ endpoint: "https://push.example/a" });
    expect(res.status).toBe(422);
    expect(h.fx.pushSubscriptionsRepo.byId.size).toBe(0);
  });

  it("201 regista para o utilizador autenticado (nunca para o de um id no corpo) e não devolve as chaves", async () => {
    const res = await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send({ ...body(), userId: USER_B });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body as object).sort()).toEqual(["createdAt", "endpoint", "id"]);
    expect([...h.fx.pushSubscriptionsRepo.byId.values()].map((s) => s.userId)).toEqual([USER_A]);
  });

  it("endpoint repetido atualiza a existente (mesmo id, sem duplicar)", async () => {
    const first = await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send(body());
    const second = await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send({ ...body(), auth: "AUTH2" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
    expect(h.fx.pushSubscriptionsRepo.byId.size).toBe(1);
  });

  it("IDOR: outro utilizador não apaga a minha subscrição (404 igual ao de um id inexistente) e eu apago a minha (204)", async () => {
    const created = await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send(body());
    const id = (created.body as { id: string }).id;
    const foreign = await request(h.app).delete(`${SUBSCRIPTIONS}/${id}`).set("Authorization", h.b);
    const ghost = await request(h.app).delete(`${SUBSCRIPTIONS}/55555555-5555-4555-8555-555555555555`).set("Authorization", h.b);
    expect(foreign.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect((foreign.body as { code: string }).code).toBe((ghost.body as { code: string }).code);
    expect(h.fx.pushSubscriptionsRepo.byId.has(id)).toBe(true);
    expect((await request(h.app).delete(`${SUBSCRIPTIONS}/${id}`).set("Authorization", h.a)).status).toBe(204);
    expect(h.fx.pushSubscriptionsRepo.byId.size).toBe(0);
  });

  it("as subscrições de cada utilizador ficam separadas e preferências pushEnabled são por utilizador", async () => {
    await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.a).send(body("https://push.example/a"));
    await request(h.app).post(SUBSCRIPTIONS).set("Authorization", h.b).send(body("https://push.example/b"));
    const byUser = (u: string) => [...h.fx.pushSubscriptionsRepo.byId.values()].filter((s) => s.userId === u).map((s) => s.endpoint);
    expect(byUser(USER_A)).toEqual(["https://push.example/a"]);
    expect(byUser(USER_B)).toEqual(["https://push.example/b"]);
    const put = await request(h.app)
      .put(`${API}/users/me/notification-preferences`)
      .set("Authorization", h.a)
      .send({ pushEnabled: false, emailEnabled: true, medicationDue: true, appointmentReminder: true, examReminder: true });
    expect(put.status).toBe(200);
    expect((await request(h.app).get(`${API}/users/me/notification-preferences`).set("Authorization", h.b)).body).toMatchObject({ pushEnabled: true });
    expect((await request(h.app).get(`${API}/users/me/notification-preferences`).set("Authorization", h.a)).body).toMatchObject({ pushEnabled: false });
  });
});
