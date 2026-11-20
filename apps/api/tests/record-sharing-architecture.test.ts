// Arquitetura de `record-sharing` (MK4; TC-MKT-138; modules.md nota 38): código real de `src/`.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkArchitecture } from "./architecture-rules.js";
import { collectImports } from "./collect-imports.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DOMAIN_DIR = join(SRC_ROOT, "modules", "record-sharing", "domain");
const moduleOf = (file: string): string | null => /^modules\/([^/]+)(\/|$)/.exec(file)?.[1] ?? null;
const FORBIDDEN = [
  "auth",
  "access",
  "families",
  "users",
  "professionals",
  "appointments",
  "processes",
  "alerts",
  "notifications",
  "messaging",
  "discovery",
  "admin",
  "lifecycle",
  "documents",
  "health-records",
  "medications",
  "prescriptions",
  "examinations",
  "clinics",
  "consultations",
];
const IO_IN_APPLICATION = ["express", "kysely", "pg", "pg-boss", "nodemailer"];
const TIME_OR_RANDOM = /\bnew Date\(|Date\.now\(|Math\.random\(/;

describe("TC-MKT-138: arquitetura de record-sharing", () => {
  it("record-sharing só importa o próprio módulo, platform/* e a raiz de audit (nenhum dos módulos proibidos)", async () => {
    const mine = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "record-sharing");
    expect(mine.length).toBeGreaterThan(0);
    for (const f of mine) {
      for (const t of f.relativeImports) {
        const m = moduleOf(t);
        expect(m === null || m === "record-sharing" || t === "modules/audit/index" || t === "modules/audit", `${f.file} -> ${t}`).toBe(true);
        expect(FORBIDDEN.includes(m ?? ""), `${f.file} -> ${t}`).toBe(false);
      }
    }
  });

  it("nenhum módulo importa record-sharing (só main/)", async () => {
    const files = await collectImports(SRC_ROOT);
    const bad = files
      .filter((f) => moduleOf(f.file) !== "record-sharing" && !f.file.startsWith("main/"))
      .flatMap((f) => f.relativeImports.filter((t) => t.startsWith("modules/record-sharing")).map((t) => `${f.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("record-sharing/domain só importa domain/ (sem bibliotecas), e nenhum ficheiro do domínio usa Date nem Math.random", async () => {
    const files = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "record-sharing");
    const domain = files.filter((x) => x.file.split("/")[2] === "domain");
    expect(domain.length).toBeGreaterThan(0);
    for (const f of domain) {
      expect(f.relativeImports.filter((t) => !t.startsWith("modules/record-sharing/domain")), f.file).toEqual([]);
      expect(f.bareImports, f.file).toEqual([]);
    }
    const sources = (await readdir(DOMAIN_DIR)).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const text = await readFile(join(DOMAIN_DIR, name), "utf8");
      expect(TIME_OR_RANDOM.test(text), `modules/record-sharing/domain/${name}`).toBe(false);
    }
  });

  it("application sem bibliotecas de I/O (express, kysely, pg, pg-boss, nodemailer)", async () => {
    const files = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "record-sharing");
    const application = files.filter((x) => x.file.split("/")[2] === "application");
    // S3 só tem domínio; a camada application chega em S6 (o laço abaixo passa a cobri-la).
    for (const f of application) {
      expect(f.bareImports.filter((p) => IO_IN_APPLICATION.includes(p)), f.file).toEqual([]);
    }
  });

  it("regras gerais de arquitetura (checkArchitecture) sem violações", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(checkArchitecture(files)).toEqual([]);
  });
});
