// RL8 (ADR-038 §5/§12): casos de uso críticos sobre um Redis REAL (testcontainers redis:7-alpine) — login (com
// `reset` após sucesso), registo, recuperação, upload de documentos, walk-in; Redis parado => 503 fechado com
// `Retry-After: 5`, degradação local só nas leituras/descoberta, recuperação; chaves sem e-mail/IP em claro.
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Redis } from "ioredis";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthFixtures } from "../../src/modules/auth/application/fixtures.js";
import { createForgotPasswordUseCase } from "../../src/modules/auth/application/forgot-password.js";
import { createLoginUseCase } from "../../src/modules/auth/application/login.js";
import { createRegisterUseCase } from "../../src/modules/auth/application/register.js";
import { hashPassword } from "../../src/modules/auth/domain/password.js";
import { createDocumentsFixtures } from "../../src/modules/documents/application/fixtures.js";
import { createUploadDocumentUseCase } from "../../src/modules/documents/application/upload-document.js";
import { createAppointmentsFixtures } from "../../src/modules/appointments/application/fixtures.js";
import { createClinicPatientLookupUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import { FixedClock, SystemClock } from "../../src/platform/clock/index.js";
import { toProblem } from "../../src/platform/errors/index.js";
import { RedisRateLimiter } from "../../src/platform/rate-limit/infrastructure/redis-rate-limiter.js";
import { RedisRateLimitStore } from "../../src/platform/rate-limit/infrastructure/redis-store.js";
import { FailMode, RateLimiterUnavailableError } from "../../src/platform/rate-limit/port.js";

const PREFIX = "vita:rl8";
const SECRET = "rl8-secret-0123456789abcdef0123456789";
const NOW = new Date("2026-10-08T10:00:00Z");
const EMAIL = "canario.rl8@exemplo.pt";
const IP = "203.0.113.77";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

describe("RL8: módulos críticos sobre Redis real", () => {
  let container: StartedTestContainer;
  let store: RedisRateLimitStore;
  let admin: Redis;
  const clock = new SystemClock();
  const make = (namespace: string): RedisRateLimiter => new RedisRateLimiter({ store, namespace, prefix: PREFIX, secret: SECRET, clock });

  async function waitReady(): Promise<void> {
    for (let i = 0; i < 60; i++) {
      if (await store.ping(500)) return;
      await sleep(200);
    }
    throw new Error("Redis não ficou pronto");
  }

  beforeAll(async () => {
    const port = await freePort();
    container = await new GenericContainer("redis:7-alpine")
      .withExposedPorts({ container: 6379, host: port })
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    const url = `redis://127.0.0.1:${String(port)}/0`;
    store = new RedisRateLimitStore({ url, commandTimeoutMs: 300, connectTimeoutMs: 500, breakerThreshold: 3, breakerOpenMs: 500 });
    admin = new Redis(url);
    admin.on("error", () => undefined);
    await waitReady();
  }, 120_000);

  afterAll(async () => {
    await store.close();
    admin.disconnect();
    await container.stop().catch(() => undefined);
  });

  const authDeps = async () => {
    const fixtures = createAuthFixtures(new FixedClock(NOW));
    const rateLimiter = make("auth");
    fixtures.usersPort.seed({
      id: "u-rl8",
      email: EMAIL,
      passwordHash: await hashPassword("Correcto-Cavalo-7"),
      name: "Ana",
      birthDate: "1990-01-01",
      timezone: "Europe/Lisbon",
      status: "ACTIVE",
      platformRole: "NONE",
      termsAcceptedVersion: "1.0.0",
      termsAcceptedAt: NOW,
      createdAt: NOW,
    });
    return { fixtures, deps: { ...fixtures.deps, rateLimiter }, rateLimiter };
  };

  it("login: 5 falhas bloqueiam a 6.ª (429); sucesso apaga o contador de falhas (reset) e a chave desaparece", async () => {
    const { deps } = await authDeps();
    const login = createLoginUseCase(deps);
    const ctx = { requestId: "r", ip: IP };
    for (let i = 0; i < 4; i++) {
      await expect(login({ email: EMAIL, password: "errada" }, ctx)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }
    const failKeysBefore = (await admin.keys(`${PREFIX}:rl:v1:auth:login-fail:*`)).length;
    expect(failKeysBefore).toBe(1);
    await expect(login({ email: EMAIL, password: "Correcto-Cavalo-7" }, ctx)).resolves.toMatchObject({ accessToken: expect.any(String) as string });
    expect(await admin.keys(`${PREFIX}:rl:v1:auth:login-fail:*`)).toHaveLength(0);
    // contador reposto: 5 novas falhas são consumidas, só a 6.ª é bloqueada
    for (let i = 0; i < 5; i++) {
      await expect(login({ email: EMAIL, password: "errada" }, ctx)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }
    const blocked = await login({ email: EMAIL, password: "Correcto-Cavalo-7" }, ctx).catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "RATE_LIMITED" });
    const problem = toProblem(blocked, "r");
    expect(problem.status).toBe(429);
    expect(problem.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(problem.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it("registo (5/5 min por IP) e recuperação (3/h por e-mail): o excedente é 429", async () => {
    const { deps } = await authDeps();
    const register = createRegisterUseCase(deps);
    const ctx = { requestId: "r", ip: "198.51.100.9" };
    const input = { email: "novo.rl8@exemplo.pt", password: "x", name: "A", birthDate: "1990-01-01", timezone: "Europe/Lisbon" } as never;
    const outcomes: unknown[] = [];
    for (let i = 0; i < 6; i++) outcomes.push(await register(input, ctx).catch((e: unknown) => e));
    expect(outcomes.filter((o) => (o as { code?: string }).code === "RATE_LIMITED")).toHaveLength(1);
    expect((outcomes[5] as { code?: string }).code).toBe("RATE_LIMITED");

    const forgot = createForgotPasswordUseCase(deps);
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) results.push(await forgot("forgot.rl8@exemplo.pt", { requestId: "r", ip: `192.0.2.${String(i)}` }).catch((e: unknown) => e));
    expect(results.filter((r) => (r as { code?: string } | undefined)?.code === "RATE_LIMITED").length).toBe(2); // 3/h por e-mail: 4.º e 5.º
  });

  it("upload de documentos: 20/h por utilizador, o 21.º é 429", async () => {
    const fixtures = createDocumentsFixtures(new FixedClock(NOW));
    const useCase = createUploadDocumentUseCase({ ...fixtures.deps, rateLimiter: make("documents") });
    const user = { userId: randomUUID(), platformAdmin: false };
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    const go = (i: number) => useCase(user, "family-1", "member-1", { resourceType: "PRESCRIPTION", resourceId: `p-${String(i)}`, file: { buffer: pdf, originalName: "a.pdf" } }, { requestId: "r" });
    for (let i = 0; i < 20; i++) await go(i);
    await expect(go(20)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("walk-in: 30/h por conta (a 31.ª é 429); 404 contados; chaves de IP/conta com TTL", async () => {
    const fx = createAppointmentsFixtures(new FixedClock(NOW));
    const lookup = createClinicPatientLookupUseCase({ ...fx.deps, walkInRateLimiter: make("clinic-walkin") });
    fx.clinics.seed("clinic-a", "Clínica", "");
    fx.patients.seed("maria@exemplo.pt", "fam-1", "mem-1", "Maria Santos Silva");
    fx.memberNames.seed("fam-1", "mem-1", "Maria Santos Silva");
    const actor = { clinicAccountId: randomUUID(), clinicId: "clinic-a" };
    for (let i = 0; i < 30; i++) {
      await lookup(actor, { email: "maria@exemplo.pt" }, { requestId: "r", ip: `10.9.${String(i)}.1` });
    }
    await expect(lookup(actor, { email: "maria@exemplo.pt" }, { requestId: "r", ip: "10.9.99.1" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("todas as chaves têm TTL, estão no namespace `{prefixo}:rl:v1:` e não contêm e-mail/IP em claro", async () => {
    const keys = await admin.keys("*");
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      expect(k.startsWith(`${PREFIX}:rl:v1:`), k).toBe(true);
      expect(await admin.pttl(k), k).toBeGreaterThan(0);
      for (const secret of [EMAIL, "canario", "exemplo.pt", IP, "198.51.100.9", "10.9.", "192.0.2."]) expect(k).not.toContain(secret);
      expect(k).toMatch(/^[A-Za-z0-9:._-]+$/);
    }
    const ipKeys = keys.filter((k) => /:(login-ip|register-ip|login-fail):/.test(k));
    expect(ipKeys.length).toBeGreaterThan(0);
    for (const k of ipKeys) expect(k.split(":").at(-1)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("Redis parado: rotas sensíveis 503 fechado + Retry-After 5; GET/descoberta degradam; recupera ao voltar", async () => {
    const auth = await authDeps();
    const login = createLoginUseCase(auth.deps);
    const upload = createUploadDocumentUseCase({ ...createDocumentsFixtures(new FixedClock(NOW)).deps, rateLimiter: make("documents") });
    const general = make("general");
    const discovery = make("discovery");
    // Redis sem resposta (CLIENT PAUSE ALL) => timeouts de comando; a readiness (PING) também falha.
    await admin.call("CLIENT", "PAUSE", "2500", "ALL");

    const err = await login({ email: EMAIL, password: "Correcto-Cavalo-7" }, { requestId: "r", ip: IP }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimiterUnavailableError);
    const problem = toProblem(err, "r");
    expect(problem.status).toBe(503);
    expect(problem.body.code).toBe("SERVICE_UNAVAILABLE");
    expect(problem.retryAfterSeconds).toBe(5);
    expect(JSON.stringify(problem.body).toLowerCase()).not.toContain("redis");
    await expect(upload({ userId: "u", platformAdmin: false }, "f", "m", { resourceType: "PRESCRIPTION", resourceId: "p", file: { buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), originalName: "a.pdf" } }, { requestId: "r" })).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    // escrita geral (CLOSED por omissão) => 503; leitura geral e descoberta (LOCAL_FALLBACK) => passam
    await expect(general.consume({ rule: "actor", subject: "u" }, { max: 300, windowMs: 60_000 })).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(general.consume({ rule: "actor", subject: "u" }, { max: 300, windowMs: 60_000 }, { failMode: FailMode.LOCAL_FALLBACK })).resolves.toMatchObject({ allowed: true });
    await expect(discovery.consume({ rule: "discovery", subject: "u" }, { max: 60, windowMs: 60_000 }, { failMode: FailMode.LOCAL_FALLBACK })).resolves.toMatchObject({ allowed: true });
    // `reset` falha fechado (e o login válido seguiria sem ele, coberto no teste unitário do auth)
    await expect(auth.rateLimiter.reset({ rule: "login-fail", subject: "x", pii: true })).rejects.toBeInstanceOf(RateLimiterUnavailableError);

    expect(await store.ping(300)).toBe(false);
    await sleep(2_800); // fim da pausa + disjuntor (breakerOpenMs=500) em meio-aberto
    await waitReady();
    await expect(login({ email: EMAIL, password: "Correcto-Cavalo-7" }, { requestId: "r", ip: "203.0.113.200" })).resolves.toMatchObject({ accessToken: expect.any(String) as string });
  }, 60_000);

  it("Redis parado de verdade (contentor removido): 503 fechado imediato com Retry-After 5", async () => {
    const auth = await authDeps();
    const login = createLoginUseCase(auth.deps);
    await container.stop({ timeout: 1 });
    const err = await login({ email: EMAIL, password: "Correcto-Cavalo-7" }, { requestId: "r", ip: IP }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimiterUnavailableError);
    expect(toProblem(err as Error, "r")).toMatchObject({ status: 503, retryAfterSeconds: 5 });
    expect(await store.ping(300)).toBe(false);
  }, 60_000);
});
