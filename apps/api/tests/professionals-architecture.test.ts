// Arquitetura do módulo `professionals` (MK1; TC-MKT-35 / TC-AZ-MKT-07; AC-MKT-11; BR-MKT-27; modules.md nota 35). Sem BD: analisa o
// código REAL de `src/` (scanner de `collect-imports.ts`, regras de `architecture-rules.ts`) e as migrações REAIS de `db/migrations/`.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkArchitecture, type FileImports } from "./architecture-rules.js";
import { collectImports } from "./collect-imports.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(TESTS_DIR, "..", "src");
const MIGRATIONS_DIR = join(TESTS_DIR, "..", "db", "migrations");
const PROFESSIONALS = "professionals";

/** Únicos módulos que `professionals` pode importar, e só pela raiz (modules.md nota 35, passo (b)). */
const ALLOWED_ROOT_MODULES = ["audit", "notifications"];

/** Lista explícita (TC-MKT-35, TC-AZ-MKT-07): `professionals` não importa nenhum destes. */
const FORBIDDEN_FROM_PROFESSIONALS = [
  "auth",
  "access",
  "families",
  "users",
  "documents",
  "clinics",
  "health-records",
  "prescriptions",
  "medications",
  "appointments",
  "examinations",
  "recommendations",
  "clinic-patients",
  "clinic-receipts",
  "clinic-reports",
  "admin",
  "lifecycle",
  "reports",
  "alerts",
  "processes",
];

/** Bibliotecas de I/O que `domain/` e `application/` nunca importam (conventions.md §3.9; TC-MKT-35 (4)). */
const IO_LIBRARIES: readonly string[] = ["express", "express-openapi-validator", "kysely", "pg", "pg-boss", "minio", "nodemailer", "ioredis", "web-push", "clamd", "pdfkit"];

/** Módulos de `src/modules/` analisados por (2): cada um que existe no disco tem de aparecer no grafo analisado. */
const OTHER_MODULES = [
  "admin",
  "alerts",
  "appointments",
  "audit",
  "auth",
  "access",
  "clinic-patients",
  "clinic-receipts",
  "clinic-reports",
  "clinics",
  "documents",
  "examinations",
  "families",
  "health-records",
  "lifecycle",
  "medications",
  "notifications",
  "prescriptions",
  "processes",
  "recommendations",
  "reports",
  "users",
];

/** Nome do módulo de um caminho relativo a `src/` (`modules/x/...` ou `modules/x`); `null` fora de `modules/`. */
function moduleOf(file: string): string | null {
  return /^modules\/([^/]+)(\/|$)/.exec(file)?.[1] ?? null;
}

function isRootOf(target: string, module: string): boolean {
  return target === `modules/${module}` || target === `modules/${module}/index`;
}

function layerOf(file: string): string | undefined {
  return file.split("/")[2];
}

function isProfessionalsTarget(target: string): boolean {
  return target === `modules/${PROFESSIONALS}` || target.startsWith(`modules/${PROFESSIONALS}/`);
}

/** Regra (1): imports de `professionals` fora de `platform/*`, do próprio módulo, da raiz de audit/notifications. */
export function professionalsOutsideViolations(files: FileImports[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (moduleOf(file.file) !== PROFESSIONALS) continue;
    for (const target of file.relativeImports) {
      const allowed =
        target === "platform" ||
        target.startsWith("platform/") ||
        isProfessionalsTarget(target) ||
        ALLOWED_ROOT_MODULES.some((module) => isRootOf(target, module));
      if (!allowed) violations.push(`${file.file} importa ${target}`);
    }
  }
  return violations;
}

/** Regra (2): nenhum ficheiro fora de `professionals` e de `main/` importa `modules/professionals`. */
export function importersOfProfessionals(files: FileImports[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (moduleOf(file.file) === PROFESSIONALS || file.file.startsWith("main/")) continue;
    for (const target of file.relativeImports) {
      if (isProfessionalsTarget(target)) found.push(`${file.file} -> ${target}`);
    }
  }
  return found;
}

/** Regra (3): imports de `professionals` para módulos de saúde/identidade/famílias/clínicas (lista explícita). */
export function professionalsImportsOfForbidden(files: FileImports[], forbidden: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (moduleOf(file.file) !== PROFESSIONALS) continue;
    for (const target of file.relativeImports) {
      const module = moduleOf(target);
      if (module !== null && forbidden.includes(module)) found.push(`${file.file} -> ${target}`);
    }
  }
  return found;
}

/** Regra (4): `domain/` e `application/` de `professionals` sem bibliotecas de I/O. */
export function professionalsIoViolations(files: FileImports[], banned: readonly string[] = IO_LIBRARIES): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (moduleOf(file.file) !== PROFESSIONALS) continue;
    const layer = layerOf(file.file);
    if (layer !== "domain" && layer !== "application") continue;
    for (const pkg of file.bareImports) {
      if (banned.includes(pkg)) violations.push(`${file.file} (${layer}) importa "${pkg}"`);
    }
  }
  return violations;
}

interface SqlReference {
  from: string;
  target: string;
}

/** Tabelas (`CREATE TABLE`) e referências (`REFERENCES` em `CREATE`, e `ALTER TABLE ... REFERENCES`) de um conjunto de migrações. */
export function parseSchema(sql: string): { tables: { name: string; body: string }[]; references: SqlReference[] } {
  const tables = [...sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)].map((m) => ({ name: m[1] ?? "", body: m[2] ?? "" }));
  const references: SqlReference[] = [];
  for (const table of tables) {
    for (const m of table.body.matchAll(/REFERENCES (\w+)/g)) references.push({ from: table.name, target: m[1] ?? "" });
  }
  for (const m of sql.matchAll(/ALTER TABLE (\w+)\s+ADD[^;]*?REFERENCES (\w+)/g)) references.push({ from: m[1] ?? "", target: m[2] ?? "" });
  return { tables, references };
}

const isProfessionalTable = (name: string): boolean => name.startsWith("professional") || name === "specialties" || name === "validation_cases";
const isProfessionalTarget = (name: string): boolean => name.startsWith("professional") || name === "specialties";

/** Regra (5): FKs de MK1 só para `professional_*`/`professionals`/`specialties`, e `validation_cases` -> `users` (decided_by). */
export function professionalFkViolations(sql: string): string[] {
  const { references } = parseSchema(sql);
  const violations: string[] = [];
  for (const ref of references) {
    if (!isProfessionalTable(ref.from)) violations.push(`${ref.from} (fora de MK1) referencia ${ref.target}`);
    else if (isProfessionalTarget(ref.target)) continue;
    else if (ref.from === "validation_cases" && ref.target === "users") continue;
    else violations.push(`${ref.from} referencia ${ref.target} (proibido em MK1)`);
  }
  return violations;
}

const FAMILY_OR_HEALTH_COLUMN = /family|member|clinic|health|allerg|prescri|medic|appoint|exam|document|guardian|tutor/i;

/** Colunas de tabelas de MK1 com nomes de dados de família/saúde (BR-MKT-27; sem `family_id`/`member_id`). */
export function professionalColumnViolations(sql: string): string[] {
  const { tables } = parseSchema(sql);
  const violations: string[] = [];
  for (const table of tables.filter((t) => isProfessionalTable(t.name))) {
    for (const m of table.body.matchAll(/^\s+([a-z_][a-z0-9_]*)\s/gm)) {
      const column = m[1] ?? "";
      if (FAMILY_OR_HEALTH_COLUMN.test(column)) violations.push(`${table.name}.${column}`);
    }
  }
  return violations;
}

describe("TC-MKT-35 / TC-AZ-MKT-07: arquitetura de professionals (código real e migrações reais)", () => {
  it("(1) ficheiros de professionals só importam o próprio módulo, platform/*, a raiz de audit e a de notifications", async () => {
    const files = await collectImports(SRC_ROOT);
    const mine = files.filter((f) => moduleOf(f.file) === PROFESSIONALS);
    expect(mine.length).toBeGreaterThan(50); // o scanner tem de ver o módulo real
    expect(mine.some((f) => f.relativeImports.includes("modules/audit/index"))).toBe(true); // a exceção de audit está em uso (não é vacuidade)
    expect(professionalsOutsideViolations(files)).toEqual([]);
  });

  it("(2) nenhum outro módulo (admin incluído) importa modules/professionals; só src/main/* o faz", async () => {
    const files = await collectImports(SRC_ROOT);
    const scanned = new Set(files.map((f) => moduleOf(f.file)));
    const onDisk = await readdir(join(SRC_ROOT, "modules"));
    for (const name of OTHER_MODULES) {
      if (onDisk.includes(name)) expect(scanned.has(name), `módulo ${name} não foi analisado`).toBe(true);
    }
    expect(importersOfProfessionals(files)).toEqual([]);
    expect(files.some((f) => f.file.startsWith("main/") && f.relativeImports.some(isProfessionalsTarget))).toBe(true);
  });

  it("(3) professionals não importa módulos de saúde, auth, access, families, users, documents nem clinics (lista explícita)", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(professionalsImportsOfForbidden(files, FORBIDDEN_FROM_PROFESSIONALS)).toEqual([]);
  });

  it("(4) domain/ e application/ de professionals não importam bibliotecas de I/O", async () => {
    const files = await collectImports(SRC_ROOT);
    const domainApp = files.filter((f) => ["domain", "application"].includes(layerOf(f.file) ?? ""));
    expect(domainApp.length).toBeGreaterThan(20);
    expect(professionalsIoViolations(files)).toEqual([]);
  });

  it("(5) migração 0043 (MK1) : FKs de MK1 só para professional_*, specialties e validation_cases->users (sem família, clínica nem saúde)", async () => {
    const sqlFiles = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) === 43).sort() // só a migração de MK1; a 0044 (messaging) é a ponte família↔profissional e tem as suas verificações;
    expect(sqlFiles).toContain("0043_professionals.sql");
    const sql = (await Promise.all(sqlFiles.map((f) => readFile(join(MIGRATIONS_DIR, f), "utf8")))).join("\n");
    const { tables, references } = parseSchema(sql);
    expect(tables.filter((t) => isProfessionalTable(t.name)).length).toBe(13); // schema.md §11: 13 tabelas
    expect(professionalFkViolations(sql)).toEqual([]);
    // As únicas referências externas (fora de professional_*/specialties) são validation_cases -> users.
    const external = [...new Set(references.filter((r) => !isProfessionalTarget(r.target)).map((r) => `${r.from}->${r.target}`))];
    expect(external).toEqual(["validation_cases->users"]);
    expect(professionalColumnViolations(sql)).toEqual([]);
  });

  it("(6) sanidade: a regra falha se se injetar um import proibido, e não falha com imports permitidos (dados sintéticos)", () => {
    const injected: FileImports[] = [
      { file: "modules/professionals/application/x", relativeImports: ["modules/families/index"], bareImports: [] },
      { file: "modules/professionals/interface/w", relativeImports: ["modules/audit/domain/event"], bareImports: [] },
      { file: "modules/professionals/domain/y", relativeImports: [], bareImports: ["kysely"] },
      { file: "modules/admin/interface/z", relativeImports: ["modules/professionals/index"], bareImports: [] },
    ];
    expect(professionalsOutsideViolations(injected)).toEqual([
      "modules/professionals/application/x importa modules/families/index",
      "modules/professionals/interface/w importa modules/audit/domain/event",
    ]);
    expect(professionalsIoViolations(injected)).toEqual(['modules/professionals/domain/y (domain) importa "kysely"']);
    expect(importersOfProfessionals(injected)).toEqual(["modules/admin/interface/z -> modules/professionals/index"]);
    expect(professionalsImportsOfForbidden(injected, FORBIDDEN_FROM_PROFESSIONALS)).toEqual(["modules/professionals/application/x -> modules/families/index"]);
    expect(checkArchitecture(injected).length).toBeGreaterThan(0); // o verificador geral também acusa

    const allowed: FileImports[] = [
      { file: "modules/professionals/application/ok", relativeImports: ["modules/audit/index", "platform/errors/index", "modules/professionals/domain/x", "modules/notifications/index"], bareImports: ["argon2", "jose"] },
      { file: "main/api", relativeImports: ["modules/professionals/index"], bareImports: [] },
    ];
    expect(professionalsOutsideViolations(allowed)).toEqual([]);
    expect(professionalsIoViolations(allowed)).toEqual([]);
    expect(importersOfProfessionals(allowed)).toEqual([]);
    expect(checkArchitecture(allowed)).toEqual([]);

    const badSql = "CREATE TABLE professional_x (\n  id uuid PRIMARY KEY,\n  family_id uuid REFERENCES families (id)\n);";
    expect(professionalFkViolations(badSql)).toEqual(["professional_x referencia families (proibido em MK1)"]);
    expect(professionalColumnViolations(badSql)).toEqual(["professional_x.family_id"]);
  });
});
