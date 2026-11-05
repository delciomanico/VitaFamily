// ADR-021/BR-INS-06/10: login, refresh rotativo, logout e agentes do portal da seguradora.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { hashInsurancePassword, verifyInsurancePassword } from "../domain/insurance-crypto.js";
import { verifyInsuranceAccessToken } from "../domain/insurance-jwt.js";
import { createInsuranceFixtures } from "./fixtures.js";
import { createInsuranceLoginUseCase } from "./insurance-login.js";
import { createInsuranceLogoutUseCase } from "./insurance-logout.js";
import { createInsuranceRefreshUseCase } from "./insurance-refresh.js";
import { createCreateInsuranceAgentUseCase, createListInsuranceAgentsUseCase, createRemoveInsuranceAgentUseCase } from "./manage-insurance-agents.js";
import { createResolveInsuranceActorStateUseCase } from "./resolve-insurance-actor-state.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const PASSWORD = "Correcto-Cavalo-7";
const CTX = { requestId: "r1", ip: "203.0.113.1" };
const ADMIN_ACTOR = { insuranceAccountId: "adm1", insurerId: "ins1", role: "INSURANCE_ADMIN" as const };
const AGENT_ACTOR = { insuranceAccountId: "ag1", insurerId: "ins1", role: "INSURANCE_AGENT" as const };

async function setup() {
  const clock = new FixedClock(NOW);
  const fx = createInsuranceFixtures(clock);
  const hash = await hashInsurancePassword(PASSWORD);
  for (const id of ["ins1", "ins2"]) fx.insurersRepo.seed({ id, name: id, taxId: id, status: "ACTIVE", createdAt: NOW });
  const acc = (id: string, insurerId: string, role: "INSURANCE_ADMIN" | "INSURANCE_AGENT") => {
    fx.insuranceAccountRepo.seed({ id, insurerId, email: `${id}@seg.pt`, passwordHash: hash, role, status: "ACTIVE", createdAt: NOW });
  };
  acc("adm1", "ins1", "INSURANCE_ADMIN");
  acc("ag1", "ins1", "INSURANCE_AGENT");
  acc("adm2", "ins2", "INSURANCE_ADMIN");
  return { fx, clock, login: createInsuranceLoginUseCase(fx.deps), refresh: createInsuranceRefreshUseCase(fx.deps) };
}

describe("insuranceLogin", () => {
  it("devolve tokens (claims iid/isid), insurerId e role; cria sessão e audita INSURANCE_ACCOUNT_LOGIN", async () => {
    const { fx, login } = await setup();
    const result = await login({ email: " AG1@seg.pt ", password: PASSWORD }, CTX);
    expect(result).toMatchObject({ expiresIn: 900, insurerId: "ins1", role: "INSURANCE_AGENT" });
    const subject = await verifyInsuranceAccessToken(result.accessToken, fx.deps.insuranceSigningKeys, NOW);
    expect(subject.insuranceAccountId).toBe("ag1");
    expect(fx.insuranceSessionRepo.sessions.size).toBe(1);
    expect(fx.audit.events[0]).toMatchObject({ actorType: "INSURANCE_ACCOUNT", actorInsuranceAccountId: "ag1", action: "INSURANCE_ACCOUNT_LOGIN", result: "SUCCESS" });
  });

  it.each([
    ["e-mail inexistente", "nobody@seg.pt", PASSWORD],
    ["palavra-passe errada", "ag1@seg.pt", "errada"],
  ])("%s -> AUTH_INVALID_CREDENTIALS genérico e audita falha", async (_n, email, password) => {
    const { fx, login } = await setup();
    await expect(login({ email, password }, CTX)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", detail: "Credenciais inválidas." });
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "INSURANCE_ACCOUNT_LOGIN_FAILED", result: "FAILURE" });
    expect(fx.insuranceSessionRepo.sessions.size).toBe(0);
  });

  it("conta suspensa -> ACCOUNT_SUSPENDED; seguradora suspensa -> ACCOUNT_SUSPENDED (BR-INS-10)", async () => {
    const { fx, login } = await setup();
    fx.insuranceAccountRepo.setStatus("ag1", "SUSPENDED");
    await expect(login({ email: "ag1@seg.pt", password: PASSWORD }, CTX)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    fx.insurersRepo.setStatus("ins2", "SUSPENDED");
    await expect(login({ email: "adm2@seg.pt", password: PASSWORD }, CTX)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(fx.insuranceSessionRepo.sessions.size).toBe(0);
  });

  it("palavra-passe errada de conta suspensa não revela o estado (401, não 403)", async () => {
    const { fx, login } = await setup();
    fx.insurersRepo.setStatus("ins1", "SUSPENDED");
    await expect(login({ email: "ag1@seg.pt", password: "errada" }, CTX)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  });

  it("rate limit: 5 falhas seguidas -> RATE_LIMITED com retryAfterMs, mesmo com a palavra-passe certa", async () => {
    const { login } = await setup();
    for (let i = 0; i < 5; i++) await expect(login({ email: "ag1@seg.pt", password: "x" }, CTX)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    await expect(login({ email: "ag1@seg.pt", password: PASSWORD }, CTX)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: expect.any(Number) as number });
  });
});

describe("insuranceRefresh (rotação e reutilização)", () => {
  it("roda o token: o antigo fica revogado, o novo mantém a cadeia", async () => {
    const { fx, login, refresh } = await setup();
    const first = await login({ email: "adm1@seg.pt", password: PASSWORD }, CTX);
    const second = await refresh({ refreshToken: first.refreshToken }, CTX);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second).toMatchObject({ insurerId: "ins1", role: "INSURANCE_ADMIN" });
    const sessions = [...fx.insuranceSessionRepo.sessions.values()];
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((s) => s.tokenChainId)).size).toBe(1);
    expect(sessions.filter((s) => s.revokedAt)).toHaveLength(1);
  });

  it("reutilização de token rodado revoga a cadeia toda e audita; o token novo também deixa de servir", async () => {
    const { fx, login, refresh } = await setup();
    const first = await login({ email: "adm1@seg.pt", password: PASSWORD }, CTX);
    const second = await refresh({ refreshToken: first.refreshToken }, CTX);
    await expect(refresh({ refreshToken: first.refreshToken }, CTX)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "INSURANCE_ACCOUNT_REFRESH_REUSE_DETECTED", result: "FAILURE" });
    await expect(refresh({ refreshToken: second.refreshToken }, CTX)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token desconhecido ou expirado -> UNAUTHENTICATED", async () => {
    const { clock, login, refresh } = await setup();
    await expect(refresh({ refreshToken: "nope" }, CTX)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const first = await login({ email: "adm1@seg.pt", password: PASSWORD }, CTX);
    clock.set(new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000));
    await expect(refresh({ refreshToken: first.refreshToken }, CTX)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("seguradora suspensa depois do login -> ACCOUNT_SUSPENDED no refresh (BR-INS-10)", async () => {
    const { fx, login, refresh } = await setup();
    const first = await login({ email: "adm1@seg.pt", password: PASSWORD }, CTX);
    fx.insurersRepo.setStatus("ins1", "SUSPENDED");
    await expect(refresh({ refreshToken: first.refreshToken }, CTX)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });
});

describe("insuranceLogout", () => {
  it("revoga a sessão atual e audita; refresh com esse token deixa de funcionar", async () => {
    const { fx, login, refresh } = await setup();
    const result = await login({ email: "adm1@seg.pt", password: PASSWORD }, CTX);
    const sessionId = fx.insuranceSessionRepo.firstId();
    await createInsuranceLogoutUseCase(fx.deps)("adm1", sessionId, CTX);
    expect(fx.insuranceSessionRepo.sessions.get(sessionId)?.revokedAt).toEqual(NOW);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "INSURANCE_ACCOUNT_LOGOUT", actorInsuranceAccountId: "adm1" });
    await expect(refresh({ refreshToken: result.refreshToken }, CTX)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("agentes (BR-INS-06, authorization.md §8.2)", () => {
  let fx: Awaited<ReturnType<typeof setup>>["fx"];
  beforeEach(async () => {
    ({ fx } = await setup());
  });

  it("INSURANCE_ADMIN cria agente (sempre INSURANCE_AGENT, na própria seguradora), palavra-passe só por e-mail, audita", async () => {
    const account = await createCreateInsuranceAgentUseCase(fx.deps)(ADMIN_ACTOR, { email: " Novo@Seg.pt " }, CTX);
    expect(account).toMatchObject({ insurerId: "ins1", email: "novo@seg.pt", role: "INSURANCE_AGENT", status: "ACTIVE" });
    const password = fx.insuranceMailer.lastSentTo("novo@seg.pt")?.text.split(": ")[1] ?? "";
    expect(await verifyInsurancePassword(account.passwordHash, password)).toBe(true);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "INSURANCE_AGENT_CREATE", actorType: "INSURANCE_ACCOUNT", actorInsuranceAccountId: "adm1", resourceId: account.id });
    expect(JSON.stringify(fx.audit.events)).not.toContain(password);
  });

  it("e-mail já usado (qualquer seguradora) -> VALIDATION_ERROR", async () => {
    await expect(createCreateInsuranceAgentUseCase(fx.deps)(ADMIN_ACTOR, { email: "adm2@seg.pt" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("INSURANCE_AGENT não lista, não cria, não remove (FORBIDDEN) e nada é auditado", async () => {
    const before = fx.audit.events.length;
    await expect(createListInsuranceAgentsUseCase(fx.deps)(AGENT_ACTOR)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createCreateInsuranceAgentUseCase(fx.deps)(AGENT_ACTOR, { email: "x@seg.pt" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createRemoveInsuranceAgentUseCase(fx.deps)(AGENT_ACTOR, "ag1", CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fx.audit.events).toHaveLength(before);
  });

  it("lista só INSURANCE_AGENT da própria seguradora (nunca o admin nem outra seguradora)", async () => {
    fx.insuranceAccountRepo.seed({ id: "ag2", insurerId: "ins2", email: "ag2@seg.pt", passwordHash: "h", role: "INSURANCE_AGENT", status: "ACTIVE", createdAt: NOW });
    const list = await createListInsuranceAgentsUseCase(fx.deps)(ADMIN_ACTOR);
    expect(list.map((a) => a.id)).toEqual(["ag1"]);
  });

  it("remove agente próprio; alvo admin, de outra seguradora ou inexistente -> NOT_FOUND", async () => {
    fx.insuranceAccountRepo.seed({ id: "ag2", insurerId: "ins2", email: "ag2@seg.pt", passwordHash: "h", role: "INSURANCE_AGENT", status: "ACTIVE", createdAt: NOW });
    const remove = createRemoveInsuranceAgentUseCase(fx.deps);
    for (const target of ["adm1", "ag2", "adm2", "nope"]) {
      await expect(remove(ADMIN_ACTOR, target, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(fx.insuranceAccountRepo.byId.has("adm1") && fx.insuranceAccountRepo.byId.has("ag2")).toBe(true);
    await remove(ADMIN_ACTOR, "ag1", CTX);
    expect(fx.insuranceAccountRepo.byId.has("ag1")).toBe(false);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "INSURANCE_AGENT_REMOVE", resourceId: "ag1" });
  });
});

describe("estado do ator por pedido (cache ≤60 s)", () => {
  it("devolve insurerId/role; conta ou seguradora suspensa => suspended; desconhecida -> UNAUTHENTICATED", async () => {
    const { fx, clock } = await setup();
    const resolve = createResolveInsuranceActorStateUseCase(fx.deps);
    expect(await resolve("ag1", "s1")).toMatchObject({ insurerId: "ins1", role: "INSURANCE_AGENT", suspended: false });
    fx.insurersRepo.setStatus("ins1", "SUSPENDED");
    expect((await resolve("ag1", "s1")).suspended).toBe(false); // ainda em cache
    clock.set(new Date(NOW.getTime() + 61_000));
    expect((await resolve("ag1", "s1")).suspended).toBe(true);
    await expect(resolve("nope", "s1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
