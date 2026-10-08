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
});
