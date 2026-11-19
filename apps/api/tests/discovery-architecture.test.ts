// Arquitetura de `discovery` (MK2 S4; TC-MKT-53; modules.md nota 36(e)): código real de `src/` e `openapi.yaml` real.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_DATA_ROUTES } from "../src/modules/discovery/interface/public-data-routes.js";
import { RANKING_INPUT_KEYS } from "../src/modules/discovery/domain/ranking.js";
import { collectImports } from "./collect-imports.js";
import { MK3_PENDING_OPERATION_IDS } from "./support/mk3-pending.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(TESTS_DIR, "..", "src");
const OPENAPI = join(TESTS_DIR, "..", "..", "..", "docs", "05-api", "openapi.yaml");
const moduleOf = (file: string): string | null => /^modules\/([^/]+)(\/|$)/.exec(file)?.[1] ?? null;

describe("TC-MKT-53: arquitetura de discovery", () => {
  it("discovery só importa o próprio módulo e platform/* (nenhum outro módulo)", async () => {
    const files = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "discovery");
    expect(files.length).toBeGreaterThan(8);
    const bad = files.flatMap((f) => f.relativeImports.filter((t) => !(t === "platform" || t.startsWith("platform/") || t.startsWith("modules/discovery"))).map((t) => `${f.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("nenhum módulo importa discovery (só main/)", async () => {
    const files = await collectImports(SRC_ROOT);
    const bad = files.filter((f) => moduleOf(f.file) !== "discovery" && !f.file.startsWith("main/")).flatMap((f) => f.relativeImports.filter((t) => t.startsWith("modules/discovery")).map((t) => `${f.file} -> ${t}`));
    expect(bad).toEqual([]);
    expect(files.some((f) => f.file.startsWith("main/") && f.relativeImports.some((t) => t.startsWith("modules/discovery")))).toBe(true);
  });

  it("domain/ só importa domain/ (sem platform nem I/O); ranking.ts sem Date/Math.random; application sem I/O", async () => {
    const files = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "discovery");
    for (const f of files.filter((x) => x.file.split("/")[2] === "domain")) {
      expect(f.relativeImports.filter((t) => !t.startsWith("modules/discovery/domain")), f.file).toEqual([]);
      expect(f.bareImports.filter((p) => !p.startsWith("node:") || p !== "node:buffer"), f.file).toEqual([]);
    }
    for (const f of files.filter((x) => x.file.split("/")[2] === "application")) {
      expect(f.bareImports.filter((p) => ["express", "kysely", "pg", "pg-boss"].includes(p)), f.file).toEqual([]);
    }
    const ranking = await readFile(join(SRC_ROOT, "modules/discovery/domain/ranking.ts"), "utf8");
    const code = ranking.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\bnew Date\b|\bDate\.now\b|Math\.random|\bimport\b/);
  });

  it("RankingInput fechado: exatamente as chaves de BR-MKT-37", () => {
    expect([...RANKING_INPUT_KEYS]).toEqual(["professionalId", "bioLength", "offers", "approvedAtMs", "reviewCount", "reviewSum"]);
  });

  it("PUBLIC_DATA_ROUTES coincide com as operações /marketplace/* do openapi.yaml e nenhuma é rota /families/*", async () => {
    const yaml = await readFile(OPENAPI, "utf8");
    const ops: { path: string; id: string }[] = [];
    let path = "";
    for (const line of yaml.split("\n")) {
      const p = /^ {2}(\/[^:]*):\s*$/.exec(line);
      if (p) path = p[1] ?? "";
      const o = /^ {6}operationId: (\w+)/.exec(line);
      if (o && path) ops.push({ path, id: o[1] ?? "" });
    }
    const market = ops.filter((o) => o.path.startsWith("/marketplace/") && !MK3_PENDING_OPERATION_IDS.has(o.id)).map((o) => o.id).sort();
    expect([...PUBLIC_DATA_ROUTES].sort()).toEqual(market);
    for (const id of PUBLIC_DATA_ROUTES) expect(ops.find((o) => o.id === id)?.path.startsWith("/families/")).toBe(false);
  });
});
