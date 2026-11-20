// Arquitetura de `record-sharing` (MK4; TC-MKT-138; modules.md nota 38): código real de `src/`.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_CATEGORIES } from "../src/modules/record-sharing/domain/index.js";
import { checkArchitecture, MODULE_DEPENDENCIES } from "./architecture-rules.js";
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

  it("tabela de dependências (architecture-rules): record-sharing e consultations só `audit`; prescriptions, medications e admin sem as arestas proibidas", () => {
    expect(MODULE_DEPENDENCIES["record-sharing"]).toEqual(["audit"]);
    expect(MODULE_DEPENDENCIES.consultations).toEqual(["audit"]);
    expect(MODULE_DEPENDENCIES.prescriptions).not.toEqual(expect.arrayContaining(["consultations"]));
    expect(MODULE_DEPENDENCIES.prescriptions).not.toEqual(expect.arrayContaining(["record-sharing"]));
    expect(MODULE_DEPENDENCIES.medications).not.toEqual(expect.arrayContaining(["prescriptions"]));
    expect(MODULE_DEPENDENCIES.admin).not.toEqual(expect.arrayContaining(["record-sharing"]));
    expect(MODULE_DEPENDENCIES.admin).not.toEqual(expect.arrayContaining(["consultations"]));
    for (const [owner, deps] of Object.entries(MODULE_DEPENDENCIES)) {
      if (owner !== "record-sharing") expect(deps, `${owner} depende de record-sharing`).not.toContain("record-sharing");
    }
  });

  it("imports reais: consultations não importa prescriptions; prescriptions não importa consultations nem record-sharing; medications não importa prescriptions; admin não importa record-sharing nem consultations", async () => {
    const files = await collectImports(SRC_ROOT);
    const importsOf = (owner: string, target: string): string[] =>
      files.filter((f) => moduleOf(f.file) === owner).flatMap((f) => f.relativeImports.filter((t) => moduleOf(t) === target).map((t) => `${f.file} -> ${t}`));
    for (const [owner, target] of [
      ["consultations", "prescriptions"],
      ["consultations", "medications"],
      ["prescriptions", "consultations"],
      ["prescriptions", "record-sharing"],
      ["medications", "prescriptions"],
      ["medications", "consultations"],
      ["medications", "record-sharing"],
      ["admin", "record-sharing"],
      ["admin", "consultations"],
      ["admin", "prescriptions"],
      ["record-sharing", "consultations"],
      ["record-sharing", "prescriptions"],
      ["record-sharing", "medications"],
      ["record-sharing", "admin"],
    ] as const) {
      expect(files.filter((f) => moduleOf(f.file) === owner).length, owner).toBeGreaterThan(0);
      expect(importsOf(owner, target), `${owner} -> ${target}`).toEqual([]);
    }
  });

  it("a tabela categoria do profissional → categorias partilháveis vive no domain e nunca há `if` por especialidade (BR-MKT-68)", async () => {
    expect([...ALLOWED_CATEGORIES.HEALTH]).toEqual(["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]);
    expect([...ALLOWED_CATEGORIES.WELLNESS]).toEqual(["MEDICATION"]);
    const mine = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "record-sharing" && !f.file.endsWith(".test"));
    const BY_SPECIALTY = /\b(specialtyId|specialtyName|specialty\.name|especialidade)\b\s*(===|!==|==|!=)|(===|!==|==|!=)\s*["'`](Cardiologia|Nutrição|Psicologia|Pediatria)/i;
    for (const f of mine) {
      const text = await readFile(join(SRC_ROOT, `${f.file}.ts`), "utf8");
      expect(BY_SPECIALTY.test(text), `${f.file}: decisão por especialidade`).toBe(false);
    }
    // A emissão da receita decide por categoria (HEALTH), nunca por uma especialidade concreta.
    const rx = await readFile(join(SRC_ROOT, "modules/consultations/application/professional-prescriptions.ts"), "utf8");
    expect(BY_SPECIALTY.test(rx)).toBe(false);
    expect(rx).toMatch(/specialty\?\.category !== "HEALTH"/);
  });

  it("DIGITAL_PRESCRIPTION_ENABLED só se lê em platform/config (o resto recebe o valor injetado: nenhum `process.env` fora de platform/config)", async () => {
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
      }
      return out;
    };
    for (const file of await walk(SRC_ROOT)) {
      const rel = file.slice(SRC_ROOT.length + 1);
      if (rel.startsWith("platform/config/") || rel.startsWith("generated/")) continue;
      const code = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/process\.env[^;\n]*DIGITAL_PRESCRIPTION_ENABLED|["'`]DIGITAL_PRESCRIPTION_ENABLED["'`]/.test(code)) offenders.push(`${rel}: lê a variável de ambiente`);
      // Só o composition root (main/) lê o valor da configuração; os módulos recebem `digitalPrescriptionEnabled` por injeção.
      if (/\bDIGITAL_PRESCRIPTION_ENABLED\b/.test(code) && !rel.startsWith("main/")) offenders.push(`${rel}: usa o nome da variável fora de platform/config e main/`);
    }
    expect(offenders).toEqual([]);
    const config = await readFile(join(SRC_ROOT, "platform/config/index.ts"), "utf8");
    expect(config).toMatch(/DIGITAL_PRESCRIPTION_ENABLED: booleanEnv\(false\)/);
  });

  it("regras gerais de arquitetura (checkArchitecture) sem violações", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(checkArchitecture(files)).toEqual([]);
  });
});
