import { Writable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Problem } from "../errors/index.js";
import { createLogger } from "../logger/index.js";
import { asyncHandler, createApp } from "./index.js";
import { REQUEST_ID_HEADER } from "./request-id.js";

function problemBody(response: request.Response): Problem {
  return response.body as Problem;
}

// apps/api/src/platform/http -> repo root (5 níveis acima).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");

const silentLogger = createLogger({ level: "silent" });

function buildApp() {
  return createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger: silentLogger,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.post("/auth/register", (_req, res) => res.status(201).json({ ok: true }));
      router.get("/users/me", (_req, res) => res.json({ ok: true }));
    },
  });
}

const validRegisterBody = {
  email: "pessoa@example.com",
  password: "palavra-passe-segura-123",
  name: "Pessoa Exemplo",
  birthDate: "1990-01-01",
  timezone: "Europe/Lisbon",
  termsVersion: "1.0.0",
};

describe("createApp", () => {
  it("responde 200 em /health sem validação OpenAPI", async () => {
    const response = await request(buildApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("gera e devolve um X-Request-Id quando o pedido não traz um válido", async () => {
    const response = await request(buildApp()).get("/health");
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(/.+/);
  });

  it("aceita um X-Request-Id de entrada válido e devolve-o tal e qual", async () => {
    const response = await request(buildApp()).get("/health").set(REQUEST_ID_HEADER, "abc12345");
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe("abc12345");
  });

  it("deixa passar um pedido válido contra o contrato (POST /auth/register)", async () => {
    const response = await request(buildApp())
      .post("/api/v1/auth/register")
      .send(validRegisterBody);
    expect(response.status).toBe(201);
  });

  it("rejeita (VALIDATION_ERROR) um corpo que viola o schema do contrato", async () => {
    const response = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ ...validRegisterBody, email: "não-é-email" });
    expect(response.status).toBe(422);
    expect(response.type).toBe("application/problem+json");
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(problemBody(response).errors).toEqual([{ field: "email", message: "valor inválido" }]);
    expect(problemBody(response).requestId).toMatch(/.+/);
  });

  it("rejeita (MALFORMED_REQUEST) um corpo que não é JSON válido", async () => {
    const response = await request(buildApp())
      .post("/api/v1/auth/register")
      .set("Content-Type", "application/json")
      .send("{not-json");
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "MALFORMED_REQUEST", status: 400 });
  });

  it("rejeita (UNAUTHENTICATED) uma rota protegida sem token (falha fechado, auth é M1)", async () => {
    const response = await request(buildApp()).get("/api/v1/users/me");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("rejeita (UNAUTHENTICATED) uma rota protegida mesmo com um token presente (sem auth em M0)", async () => {
    const response = await request(buildApp())
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer qualquer.coisa.aqui");
    expect(response.status).toBe(401);
    expect(problemBody(response).code).toBe("UNAUTHENTICATED");
  });

  it("responde 404 Problem (NOT_FOUND) para uma rota fora do contrato", async () => {
    const response = await request(buildApp()).get("/api/v1/isto-nao-existe");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("responde 404 Problem para qualquer caminho fora de /health e /api/v1", async () => {
    const response = await request(buildApp()).get("/nao-existe");
    expect(response.status).toBe(404);
    expect(problemBody(response).code).toBe("NOT_FOUND");
  });

  it("asyncHandler encaminha rejeições para o middleware de erro", async () => {
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: silentLogger,
      registerHealthRoutes: (router) => {
        router.get(
          "/health",
          asyncHandler(async () => {
            await Promise.resolve();
            throw new Error("boom");
          }),
        );
      },
    });
    const response = await request(app).get("/health");
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(problemBody(response).detail).toBeUndefined();
  });

  // Regressão (Fase G, QA/segurança do portal da clínica): `ClinicCompleteAppointmentRequest.prescription`
  // combinava `nullable: true` com `allOf: [$ref]` sem `type`, o que faz o AJV usado pelo
  // express-openapi-validator recusar-se a compilar TODO o contrato ("nullable cannot be used
  // without type") — qualquer pedido validado pelo contrato (não só este endpoint) passava a
  // responder 500 em vez do código esperado. Este teste garante que o contrato inteiro continua a
  // compilar e que esta rota específica responde 401 (falha fechada, sem handler de
  // `clinicBearerAuth`) em vez de 500.
  it("carrega o contrato inteiro sem erro de schema do AJV (regressão ClinicCompleteAppointmentRequest.prescription)", async () => {
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: silentLogger,
      securityHandlers: { clinicBearerAuth: () => Promise.reject(new Error("sem sessão do portal da clínica")) },
      registerHealthRoutes: (router) => {
        router.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
      registerRoutes: (router) => {
        router.put("/clinic-portal/agenda/:appointmentId/complete", (_req, res) => res.json({ ok: true }));
      },
    });
    const response = await request(app)
      .put("/api/v1/clinic-portal/agenda/11111111-1111-1111-1111-111111111111/complete")
      .send({ outcomeNote: "Consulta concluída.", prescription: null });
    expect(response.status).toBe(401);
    expect(problemBody(response).code).toBe("UNAUTHENTICATED");
  });
});

describe("trust proxy (TRUST_PROXY)", () => {
  // O peer TCP do supertest é 127.0.0.1/::ffff:127.0.0.1 (o último proxy, p.ex. nginx do web).
  async function ipSeen(trustProxy: number | string[] | undefined, xff?: string): Promise<string> {
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: silentLogger,
      ...(trustProxy === undefined ? {} : { trustProxy }),
      registerHealthRoutes: (router) => {
        router.get("/health", (req, res) => res.json({ ip: req.ip }));
      },
    });
    const req = request(app).get("/health");
    if (xff) void req.set("X-Forwarded-For", xff);
    return ((await req).body as { ip: string }).ip;
  }

  it("1 salto (default): XFF 'cliente' -> cliente; XFF forjado pelo cliente não prevalece sobre o que o proxy acrescentou", async () => {
    expect(await ipSeen(undefined, "203.0.113.7")).toBe("203.0.113.7");
    // cliente forjou 9.9.9.9; o proxy acrescentou o IP real à direita
    expect(await ipSeen(1, "9.9.9.9, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("2 saltos (Traefik -> nginx -> api): usa o cliente; forjado fica à esquerda e é ignorado", async () => {
    expect(await ipSeen(2, "203.0.113.7, 10.0.0.2")).toBe("203.0.113.7");
    expect(await ipSeen(2, "9.9.9.9, 203.0.113.7, 10.0.0.2")).toBe("203.0.113.7");
  });

  it("3 saltos (CDN + Traefik + nginx): usa o cliente; forjado ignorado", async () => {
    expect(await ipSeen(3, "203.0.113.7, 172.70.0.1, 10.0.0.2")).toBe("203.0.113.7");
    expect(await ipSeen(3, "9.9.9.9, 203.0.113.7, 172.70.0.1, 10.0.0.2")).toBe("203.0.113.7");
  });

  it("saltos a menos dão o IP de um proxy (balde global): é o risco que TRUST_PROXY=2 evita", async () => {
    expect(await ipSeen(1, "203.0.113.7, 10.0.0.2")).toBe("10.0.0.2");
  });

  it("lista de CIDR: só confia nos proxies listados", async () => {
    expect(await ipSeen(["loopback", "10.0.0.0/8"], "9.9.9.9, 203.0.113.7, 10.0.0.2")).toBe("203.0.113.7");
    expect(await ipSeen(["10.0.0.0/8"], "203.0.113.7")).toMatch(/127\.0\.0\.1/);
  });
});

describe("error-middleware: erros do driver pg nos logs", () => {
  it("500 com erro pg: o log não contém detail/where/parameters (canário) e a resposta é neutra", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk.toString("utf8"));
        cb();
      },
    });
    const pgErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(CANARIO@exemplo.pt) already exists.",
      where: "CANARIO-WHERE",
      parameters: ["CANARIO-PARAM"],
    });
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: createLogger({ destination }),
      registerHealthRoutes: (router) => {
        router.get("/health", () => {
          throw pgErr;
        });
      },
      registerRoutes: () => undefined,
    });
    const response = await request(app).get("/health");
    expect(response.status).toBe(500);
    const logs = chunks.join("");
    expect(logs).toContain("unhandled_error");
    for (const canary of ["CANARIO@exemplo.pt", "CANARIO-WHERE", "CANARIO-PARAM"]) {
      expect(logs).not.toContain(canary);
      expect(JSON.stringify(response.body)).not.toContain(canary);
    }
  });
});
