// Arquitetura de `messaging` (MK2 S5; modules.md nota 36(e)): código real de `src/`.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkArchitecture } from "./architecture-rules.js";
import { collectImports } from "./collect-imports.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const moduleOf = (file: string): string | null => /^modules\/([^/]+)(\/|$)/.exec(file)?.[1] ?? null;
const FORBIDDEN = ["auth", "access", "families", "professionals", "notifications", "alerts", "admin", "lifecycle", "users", "documents", "health-records", "medications", "prescriptions", "appointments", "examinations", "clinics", "discovery"];

describe("arquitetura de messaging", () => {
  it("messaging só importa o próprio módulo, platform/* e a raiz de audit (nenhum dos módulos proibidos)", async () => {
    const mine = (await collectImports(SRC_ROOT)).filter((f) => moduleOf(f.file) === "messaging");
    expect(mine.length).toBeGreaterThan(6);
    for (const f of mine) {
      for (const t of f.relativeImports) {
        const m = moduleOf(t);
        expect(m === null || m === "messaging" || t === "modules/audit/index" || t === "modules/audit", `${f.file} -> ${t}`).toBe(true);
        expect(FORBIDDEN.includes(m ?? ""), `${f.file} -> ${t}`).toBe(false);
      }
    }
  });
  it("nenhum módulo importa messaging (só main/)", async () => {
    const files = await collectImports(SRC_ROOT);
    const bad = files.filter((f) => moduleOf(f.file) !== "messaging" && !f.file.startsWith("main/")).flatMap((f) => f.relativeImports.filter((t) => t.startsWith("modules/messaging")).map((t) => `${f.file} -> ${t}`));
    expect(bad).toEqual([]);
  });
  it("domain/ só importa domain/ (puro: sem platform, sem I/O); application sem bibliotecas de I/O; regras gerais sem violações", async () => {
    const files = await collectImports(SRC_ROOT);
    const mine = files.filter((f) => moduleOf(f.file) === "messaging");
    for (const f of mine.filter((x) => x.file.split("/")[2] === "domain")) {
      expect(f.relativeImports.filter((t) => !t.startsWith("modules/messaging/domain")), f.file).toEqual([]);
      expect(f.bareImports, f.file).toEqual([]);
    }
    for (const f of mine.filter((x) => x.file.split("/")[2] === "application")) {
      expect(f.bareImports.filter((p) => ["express", "kysely", "pg", "pg-boss", "nodemailer"].includes(p)), f.file).toEqual([]);
    }
    expect(checkArchitecture(files)).toEqual([]);
  });
});
