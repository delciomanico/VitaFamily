import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractUpSql } from "./migrate-runner.js";

describe("extractUpSql", () => {
  it("devolve só o conteúdo entre -- +goose Up e -- +goose Down (reaproveitado de ADR-012)", () => {
    const content = [
      "-- +goose Up",
      "CREATE TABLE a (id int);",
      "-- +goose Down",
      "DROP TABLE a;",
    ].join("\n");
    expect(extractUpSql(content).trim()).toBe("CREATE TABLE a (id int);");
  });

  it("devolve o ficheiro inteiro quando não há marcadores (migrações novas, SQL simples)", () => {
    const content = "CREATE TABLE b (id int);";
    expect(extractUpSql(content)).toBe(content);
  });

  it("ignora espaços/maiúsculas nos marcadores", () => {
    const content = ["--   +GOOSE up", "SELECT 1;", "--+goose down", "SELECT 2;"].join("\n");
    expect(extractUpSql(content).trim()).toBe("SELECT 1;");
  });

  it("extrai corretamente a migração 0001 real (extensões e enums)", async () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "migrations",
      "0001_extensions_and_enums.sql",
    );
    const content = await readFile(path, "utf8");
    const up = extractUpSql(content);
    expect(up).toContain("CREATE EXTENSION IF NOT EXISTS citext");
    expect(up).toContain("CREATE TYPE user_status AS ENUM");
    expect(up).not.toContain("DROP TYPE IF EXISTS user_status");
  });
});
