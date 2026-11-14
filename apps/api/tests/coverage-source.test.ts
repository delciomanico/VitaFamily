// TC-COV-13 / BR-SEG-41: nenhuma cópia da lógica de cobertura. Fora de `domain/coverage.ts`, o domínio e a aplicação de
// `insurer-ops` não decidem cobertura comparando `waitingDays`/`validFrom`/`validTo`/estado de beneficiário ou apólice, e
// `isEligible`/`toCoverageLimits` não existem como regras (só o mapeador `CoverageDecision → CoverageLimits`).
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "modules", "insurer-ops");

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

// Comparações de carência/janela/estado de apólice e beneficiário que são decisão de cobertura.
const COVERAGE_COMPARISON = [
  /\bwaitingDays\s*(?:[<>]=?|===?|!==?)\s*\d/,
  /\b(?:today|date|day)\s*(?:[<>]=?)\s*[\w.]*(?:validFrom|validTo|waitingEndsOn)\b/,
  /\b[\w.]*(?:validFrom|validTo)\s*(?:[<>]=?)\s*(?:today|date|day)\b/,
  /\b(?:candidate|beneficiary|policy)\??\.status\s*(?:===?|!==?)\s*["']ACTIVE["']/,
];

describe("BR-SEG-41 uma só função de cobertura (TC-COV-13)", () => {
  it("fora de domain/coverage.ts não há comparações de cobertura nem isEligible", async () => {
    const offenders: string[] = [];
    for (const file of (await files(join(MODULE, "domain"))).concat(await files(join(MODULE, "application")))) {
      if (file.endsWith(join("domain", "coverage.ts"))) continue;
      const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/\bisEligible\b/.test(text) || COVERAGE_COMPARISON.some((re) => re.test(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("toCoverageLimits é só mapeador: recebe uma CoverageDecision", async () => {
    const text = await readFile(join(MODULE, "domain", "eligibility.ts"), "utf8");
    expect(text).toMatch(/export function toCoverageLimits\(row: CoverageRowForEligibility, decision: CoverageDecision\)/);
  });

  it("TC-CAT-06 BR-SEG-39/40: sem literais de tipos de guia/despesa nem de chaves de política em código não-teste de insurer-ops", async () => {
    const literals = /["'`](CONSULTATION|SERVICES|ADMISSION|INPATIENT|CHILDBIRTH|DIAGNOSTICS|TREATMENT|DENTAL|PROSTHETICS|MEDICATION|DAILY_ALLOWANCE|AUTHORIZATION_DECISION_HOURS|APPEAL_REQUEST_DAYS|APPEAL_RESPONSE_HOURS|INFO_REQUEST_EXPIRY_DAYS|URGENT_NOTICE_HOURS)["'`]/;
    const offenders: string[] = [];
    for (const file of await files(MODULE)) {
      // Fatia 3: `domain/policy-setting.ts` é o ÚNICO sítio que nomeia as chaves (`POLICY_KEYS`); os valores nunca (TC-AUT-18).
      if (file.endsWith(join("domain", "policy-setting.ts"))) continue;
      const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (literals.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
