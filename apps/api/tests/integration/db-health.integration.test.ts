// Teste de integração real (testcontainers + PostgreSQL): prova que o runner de migrações aplica
// db/migrations/*.sql a uma base real e que /health/ready reflete a ligação real à BD.
import { Router } from "express";
import { Pool } from "pg";
import request from "supertest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { checkConnection } from "../../src/platform/db/index.js";
import { ServiceUnavailableError } from "../../src/platform/errors/index.js";
import { asyncHandler, createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";

const OPENAPI_SPEC_PATH = new URL("../../../../docs/05-api/openapi.yaml", import.meta.url).pathname;

describe("integração: migrate-runner + /health/ready contra um Postgres real", () => {
  let container: StartedTestContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    pool = new Pool({ connectionString: `postgres://vita:vita@${host}:${String(port)}/vita` });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("aplica a migração 0001 (extensões e enums) e regista em schema_migrations", async () => {
    const results = await runMigrations(pool, defaultMigrationsDir());
    expect(results.find((r) => r.version === "0001_extensions_and_enums")).toEqual({
      version: "0001_extensions_and_enums",
      applied: true,
    });

    const enumType = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'user_status'");
    expect(enumType.rowCount).toBe(1);

    const migrationRow = await pool.query(
      "SELECT version FROM schema_migrations WHERE version = '0001_extensions_and_enums'",
    );
    expect(migrationRow.rowCount).toBe(1);
  });

  it("é idempotente: reaplicar não falha nem duplica o registo", async () => {
    const results = await runMigrations(pool, defaultMigrationsDir());
    expect(results.find((r) => r.version === "0001_extensions_and_enums")).toEqual({
      version: "0001_extensions_and_enums",
      applied: false,
    });
    const migrationRows = await pool.query(
      "SELECT version FROM schema_migrations WHERE version = '0001_extensions_and_enums'",
    );
    expect(migrationRows.rowCount).toBe(1);
  });

  it("checkConnection() devolve true com a BD real a responder", async () => {
    await expect(checkConnection(pool)).resolves.toBe(true);
  });

  it("GET /health/ready devolve 200 quando a BD responde", async () => {
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: createLogger({ level: "silent" }),
      registerHealthRoutes: (router: Router) => {
        router.get("/health", (_req, res) => res.json({ status: "ok" }));
        router.get(
          "/health/ready",
          asyncHandler(async (_req, res, next) => {
            const healthy = await checkConnection(pool);
            if (!healthy) {
              next(new ServiceUnavailableError({ detail: "Base de dados indisponível." }));
              return;
            }
            res.json({ status: "ok" });
          }),
        );
      },
    });

    const response = await request(app).get("/health/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });

    const responseUnderApi = await request(app).get("/api/v1/health/ready");
    expect(responseUnderApi.status).toBe(200);
  });

  it("GET /health/ready devolve 503 Problem quando a BD está em baixo", async () => {
    const downPool = new Pool({ connectionString: "postgres://vita:vita@127.0.0.1:1/vita" });
    const app = createApp({
      openApiSpecPath: OPENAPI_SPEC_PATH,
      logger: createLogger({ level: "silent" }),
      registerHealthRoutes: (router: Router) => {
        router.get(
          "/health/ready",
          asyncHandler(async (_req, res, next) => {
            const healthy = await checkConnection(downPool);
            if (!healthy) {
              next(new ServiceUnavailableError({ detail: "Base de dados indisponível." }));
              return;
            }
            res.json({ status: "ok" });
          }),
        );
      },
    });

    const response = await request(app).get("/health/ready");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
    await downPool.end();
  });
});
