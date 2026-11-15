// TC-DEC-20 / TC-DEC-14 (modules.md nota 32, ADR-035): verificações de código-fonte da fatia 4. `auto-approval.ts` não decide por
// código de serviço nem por tipo literal (as regras são dados, §2.4); só `insurer-ops` toca em `insurer_authorizations` (por isso a falta
// de comparência/reagendamento nunca altera uma aprovação, Q-S3, BR-AUT-10); os routers só dependem de casos de uso.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const MODULE = join(SRC, "modules", "insurer-ops");

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const code = async (path: string) => (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("fatia 4: fonte do código", () => {
  it("auto-approval.ts: sem `if (serviceCode …)`, sem tipos de serviço literais, sem relógio nem I/O", async () => {
    const text = await code(join(MODULE, "domain", "auto-approval.ts"));
    expect(text).not.toMatch(/serviceCode/);
    expect(text).not.toMatch(/["'`](CONSULTATION|INPATIENT|ADMISSION|DIAGNOSTICS|TREATMENT|DENTAL|SERVICES)["'`]/);
    expect(text).not.toMatch(/new Date|Date\.now|from "node:|from "kysely|from "express/);
    for (const line of text.split("\n").filter((l) => /^\s*import /.test(l))) expect(line, line).toMatch(/from "\.\//);
  });

  it("authorization-actions.ts e sla.ts: puros (sem relógio próprio nem imports fora de domain/)", async () => {
    for (const name of ["authorization-actions", "sla"]) {
      const text = await code(join(MODULE, "domain", `${name}.ts`));
      expect(text, name).not.toMatch(/new Date\(\)|Date\.now/);
      for (const line of text.split("\n").filter((l) => /^\s*import /.test(l))) expect(line, `${name}: ${line}`).toMatch(/from "\.\//);
    }
  });

  it("só `insurer-ops` lê ou escreve `insurer_authorizations`/`insurer_auto_approval_rules` (nenhuma transição de marcação ou atendimento lhes toca: Q-S3, BR-AUT-10)", async () => {
    const offenders: string[] = [];
    for (const file of await files(join(SRC, "modules"))) {
      if (file.startsWith(MODULE)) continue;
      if (/insurer_authorizations|insurer_auto_approval_rules|insurer_authorization_events/.test(await code(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("os routers da fatia 4 só importam casos de uso (application), tipos de domain e a plataforma; nunca infrastructure", async () => {
    const text = await readFile(join(MODULE, "interface", "insurer-authorizations-router.ts"), "utf8");
    expect(text).not.toMatch(/from "\.\.\/infrastructure/);
    expect(text).not.toMatch(/kysely|pg-boss/);
  });

  it("a validade e os prazos da decisão vêm de resolvePolicySetting: só `policy-setting.ts` nomeia as chaves", async () => {
    for (const file of await files(MODULE)) {
      if (file.endsWith(join("domain", "policy-setting.ts"))) continue;
      expect(await code(file), file).not.toMatch(/["'`](AUTHORIZATION_VALIDITY_DAYS|APPEAL_RESPONSE_HOURS)["'`]/);
    }
  });
});
