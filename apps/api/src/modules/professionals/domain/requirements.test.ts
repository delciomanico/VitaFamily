// Testes unitários dos requisitos de submissão/aprovação (TC-MKT-06/20, BR-MKT-16) e análise estática de pureza do domínio. Sem I/O
// nos testes de regras; a análise estática lê só o código de produção do próprio domínio.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_CREDENTIALS_BY_CATEGORY,
  deriveRequirements,
  failsByExpiry,
  requiredKinds,
  type CredentialKind,
  type ProfessionalRequirement,
  type RequirementsInput,
  type ScanStatus,
} from "./requirements.js";

const TODAY = "2026-11-16";

interface Credential {
  kind: CredentialKind;
  scanStatus: ScanStatus;
  validUntil: string | null;
}

/** Perfil completo (nome, cidade, uma especialidade ativa) sem credenciais; cada teste sobrepõe o que interessa. */
function input(overrides: Partial<RequirementsInput> = {}): RequirementsInput {
  return {
    displayName: "Ana Silva",
    city: "Luanda",
    specialties: [{ category: "HEALTH", active: true }],
    credentials: [],
    today: TODAY,
    ...overrides,
  };
}

const identity = (scanStatus: ScanStatus = "CLEAN", validUntil: string | null = null): Credential => ({ kind: "IDENTITY", scanStatus, validUntil });
const license = (scanStatus: ScanStatus = "CLEAN", validUntil: string | null = null): Credential => ({
  kind: "PROFESSIONAL_LICENSE",
  scanStatus,
  validUntil,
});
const certification = (scanStatus: ScanStatus = "CLEAN", validUntil: string | null = null): Credential => ({
  kind: "CERTIFICATION",
  scanStatus,
  validUntil,
});

describe("requiredKinds / REQUIRED_CREDENTIALS_BY_CATEGORY (BR-MKT-16)", () => {
  it.each([
    ["HEALTH", ["IDENTITY", "PROFESSIONAL_LICENSE"]],
    ["WELLNESS", ["IDENTITY", "CERTIFICATION"]],
  ] as const)("categoria %s exige %j", (category, kinds) => {
    expect(REQUIRED_CREDENTIALS_BY_CATEGORY[category]).toEqual(kinds);
    expect(requiredKinds([{ category, active: true }])).toEqual(kinds);
  });

  it("mista é a união das categorias, sem duplicados e pela ordem IDENTITY, PROFESSIONAL_LICENSE, CERTIFICATION", () => {
    const specialties = [
      { category: "WELLNESS" as const, active: true },
      { category: "HEALTH" as const, active: true },
      { category: "WELLNESS" as const, active: false },
    ];
    expect(requiredKinds(specialties)).toEqual(["IDENTITY", "PROFESSIONAL_LICENSE", "CERTIFICATION"]);
  });

  it("especialidades inativas também contam para os requisitos (aperto seguro, OP-74)", () => {
    expect(requiredKinds([{ category: "HEALTH", active: false }])).toEqual(["IDENTITY", "PROFESSIONAL_LICENSE"]);
  });

  it("sem especialidades não se exige credencial", () => {
    expect(requiredKinds([])).toEqual([]);
  });

  it("trocar a categoria de uma especialidade muda o resultado sem alterar código", () => {
    const asHealth = deriveRequirements(input({ specialties: [{ category: "HEALTH", active: true }], credentials: [identity()] }));
    const asWellness = deriveRequirements(input({ specialties: [{ category: "WELLNESS", active: true }], credentials: [identity()] }));
    expect(asHealth).toEqual(["CREDENTIAL_PROFESSIONAL_LICENSE"]);
    expect(asWellness).toEqual(["CREDENTIAL_CERTIFICATION"]);
  });
});

describe("deriveRequirements (TC-MKT-06)", () => {
  it("perfil completo com credenciais HEALTH válidas não tem requisitos em falta", () => {
    expect(deriveRequirements(input({ credentials: [identity(), license()] }))).toEqual([]);
  });

  it("perfil completo com credenciais WELLNESS válidas não tem requisitos em falta", () => {
    expect(
      deriveRequirements(input({ specialties: [{ category: "WELLNESS", active: true }], credentials: [identity(), certification()] })),
    ).toEqual([]);
  });

  it("HEALTH sem credenciais exige identificação e cédula", () => {
    expect(deriveRequirements(input())).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_PROFESSIONAL_LICENSE"]);
  });

  it("WELLNESS sem credenciais exige identificação e certificação", () => {
    expect(deriveRequirements(input({ specialties: [{ category: "WELLNESS", active: true }] }))).toEqual([
      "CREDENTIAL_IDENTITY",
      "CREDENTIAL_CERTIFICATION",
    ]);
  });

  it("mista exige a união das credenciais", () => {
    const specialties = [
      { category: "HEALTH" as const, active: true },
      { category: "WELLNESS" as const, active: true },
    ];
    expect(deriveRequirements(input({ specialties }))).toEqual([
      "CREDENTIAL_IDENTITY",
      "CREDENTIAL_PROFESSIONAL_LICENSE",
      "CREDENTIAL_CERTIFICATION",
    ]);
  });

  it("não exige nome, cidade nem especialidade para as credenciais (ordem: nome, cidade, especialidade)", () => {
    expect(deriveRequirements(input({ displayName: null, city: null, specialties: [] }))).toEqual([
      "DISPLAY_NAME",
      "CITY",
      "SPECIALTY",
    ]);
  });

  it.each([
    ["nome nulo", { displayName: null }, "DISPLAY_NAME"],
    ["nome só com espaços", { displayName: "   " }, "DISPLAY_NAME"],
    ["cidade vazia", { city: "" }, "CITY"],
  ] as const)("falta de %s gera %s", (_label, overrides, requirement) => {
    expect(deriveRequirements(input({ credentials: [identity(), license()], ...overrides }))).toEqual([requirement]);
  });

  it("só especialidade inativa gera SPECIALTY em falta", () => {
    const missing = deriveRequirements(input({ specialties: [{ category: "HEALTH", active: false }], credentials: [identity(), license()] }));
    expect(missing).toEqual(["SPECIALTY"]);
  });

  it("uma especialidade ativa basta mesmo com outras inativas", () => {
    const specialties = [
      { category: "HEALTH" as const, active: false },
      { category: "HEALTH" as const, active: true },
    ];
    expect(deriveRequirements(input({ specialties, credentials: [identity(), license()] }))).toEqual([]);
  });

  it("credencial PENDING gera CREDENTIAL_SCAN_PENDING", () => {
    expect(deriveRequirements(input({ credentials: [identity("PENDING"), license()] }))).toEqual(["CREDENTIAL_SCAN_PENDING"]);
  });

  it("só credencial INFECTED gera CREDENTIAL_INFECTED", () => {
    expect(deriveRequirements(input({ credentials: [identity(), license("INFECTED")] }))).toEqual(["CREDENTIAL_INFECTED"]);
  });

  it("credencial CLEAN caducada (validUntil < hoje) gera CREDENTIAL_EXPIRED", () => {
    const missing = deriveRequirements(input({ credentials: [identity(), license("CLEAN", "2026-11-15")] }));
    expect(missing).toEqual(["CREDENTIAL_EXPIRED"]);
    expect(failsByExpiry(missing)).toBe(true);
  });

  it("validUntil igual a hoje é válida", () => {
    expect(deriveRequirements(input({ credentials: [identity(), license("CLEAN", TODAY)] }))).toEqual([]);
  });

  it("validUntil nulo é válida", () => {
    expect(deriveRequirements(input({ credentials: [identity(), license("CLEAN", null)] }))).toEqual([]);
  });

  it("outra credencial CLEAN e válida do mesmo tipo satisfaz, mesmo com uma caducada", () => {
    const credentials = [identity(), license("CLEAN", "2020-01-01"), license("CLEAN", "2027-06-30")];
    expect(deriveRequirements(input({ credentials }))).toEqual([]);
  });

  it("ignora credenciais de tipos que a categoria não exige", () => {
    const credentials = [identity(), license(), certification("PENDING"), certification("INFECTED")];
    expect(deriveRequirements(input({ credentials }))).toEqual([]);
  });

  it("credencial de tipo exigido em falta gera o código do tipo", () => {
    expect(deriveRequirements(input({ credentials: [license()] }))).toEqual(["CREDENTIAL_IDENTITY"]);
  });

  it("devolve lista sem duplicados quando várias credenciais do mesmo tipo falham", () => {
    const credentials: Credential[] = [license("PENDING"), license("PENDING")];
    expect(deriveRequirements(input({ credentials }))).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_SCAN_PENDING"]);
  });

  it("com análise pendente e caducada do mesmo tipo reporta só a pendente (a caducada só aparece após o scan)", () => {
    const missing = deriveRequirements(input({ credentials: [identity(), license("PENDING"), license("CLEAN", "2020-01-01")] }));
    expect(missing).toEqual(["CREDENTIAL_SCAN_PENDING"]);
  });

  it("requisitos do perfil vêm antes das credenciais; pendente antes de infetada", () => {
    const missing = deriveRequirements(input({ displayName: null, credentials: [identity("INFECTED"), license("PENDING")] }));
    expect(missing).toEqual<ProfessionalRequirement[]>(["DISPLAY_NAME", "CREDENTIAL_SCAN_PENDING", "CREDENTIAL_INFECTED"]);
  });
});

describe("failsByExpiry (BR-MKT-21)", () => {
  it.each([
    [[], false],
    [["CREDENTIAL_IDENTITY"], false],
    [["CREDENTIAL_SCAN_PENDING", "CREDENTIAL_INFECTED"], false],
    [["CREDENTIAL_EXPIRED"], true],
    [["SPECIALTY", "CREDENTIAL_EXPIRED"], true],
  ] as const)("%j => %s", (missing, expected) => {
    expect(failsByExpiry(missing)).toBe(expected);
  });
});

describe("análise estática do domínio (sem nomes de especialidades concretas)", () => {
  const DOMAIN_DIR = fileURLToPath(new URL(".", import.meta.url));
  const SPECIFIC_SPECIALTY = /Nutri|Psicolog|Cardiolog|Fisioterap/i;
  const productionFiles = readdirSync(DOMAIN_DIR).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

  it("encontra os ficheiros de produção do domínio", () => {
    expect(productionFiles).toEqual(expect.arrayContaining(["requirements.ts", "validation-status.ts", "offer.ts", "schedule.ts"]));
  });

  it.each(productionFiles)("%s não compara com nomes de especialidades concretas", (file) => {
    const source = readFileSync(join(DOMAIN_DIR, file), "utf8");
    expect(source).not.toMatch(SPECIFIC_SPECIALTY);
  });
});
