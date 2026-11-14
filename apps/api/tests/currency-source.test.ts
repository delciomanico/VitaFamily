// TC-MOE-04 / BR-SEG-42: fonte única da moeda = `insurer_accounts.currency`. Falha se existir moeda por omissão
// (literal `EUR` ou `DEFAULT_CURRENCY`) em código não-teste de `insurance`/`insurer-ops` ou default no contrato.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith("fixtures.ts")) out.push(path);
  }
  return out;
}

describe("BR-SEG-42 moeda de fonte única (TC-MOE-04)", () => {
  it("sem literal EUR nem DEFAULT_CURRENCY em insurance/insurer-ops", async () => {
    const offenders: string[] = [];
    for (const module of ["insurance", "insurer-ops"]) {
      for (const file of await sourceFiles(join(ROOT, "src", "modules", module))) {
        if (/["'`]EUR["'`]|DEFAULT_CURRENCY\b/.test(await readFile(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("openapi: ReimbursementClaimInput.currency sem default", async () => {
    const yaml = await readFile(join(ROOT, "..", "..", "docs", "05-api", "openapi.yaml"), "utf8");
    const block = /\n {4}ReimbursementClaimInput:\n([\s\S]*?)\n {4}[A-Za-z]+:\n/.exec(yaml)?.[1] ?? "";
    const currency = /\n {8}currency:\n([\s\S]*?)\n {8}[a-zA-Z]+:/.exec(block)?.[1] ?? "";
    expect(currency).not.toBe("");
    expect(currency).not.toMatch(/default:/);
  });
});
