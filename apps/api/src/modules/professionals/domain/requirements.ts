// Requisitos de submissão/aprovação (BR-MKT-16): função pura `deriveRequirements`, usada na submissão, em APPROVE/REACTIVATE
// e no job de caducidade (BR-MKT-21). A tabela categoria → credenciais é uma CONSTANTE do domínio (não por especialidade) e está
// sujeita ao parecer jurídico (OP-61).
export type SpecialtyCategory = "HEALTH" | "WELLNESS";
export type CredentialKind = "IDENTITY" | "PROFESSIONAL_LICENSE" | "CERTIFICATION";
export type ScanStatus = "PENDING" | "CLEAN" | "INFECTED";

export type ProfessionalRequirement =
  | "DISPLAY_NAME"
  | "CITY"
  | "SPECIALTY"
  | "CREDENTIAL_IDENTITY"
  | "CREDENTIAL_PROFESSIONAL_LICENSE"
  | "CREDENTIAL_CERTIFICATION"
  | "CREDENTIAL_SCAN_PENDING"
  | "CREDENTIAL_INFECTED"
  | "CREDENTIAL_EXPIRED";

export const MAX_SPECIALTIES = 5;
export const MAX_CREDENTIALS = 10;

/** BR-MKT-16: `HEALTH` = identificação + cédula/inscrição; `WELLNESS` = identificação + certificação. */
export const REQUIRED_CREDENTIALS_BY_CATEGORY: Record<SpecialtyCategory, readonly CredentialKind[]> = {
  HEALTH: ["IDENTITY", "PROFESSIONAL_LICENSE"],
  WELLNESS: ["IDENTITY", "CERTIFICATION"],
};

const MISSING_CODE: Record<CredentialKind, ProfessionalRequirement> = {
  IDENTITY: "CREDENTIAL_IDENTITY",
  PROFESSIONAL_LICENSE: "CREDENTIAL_PROFESSIONAL_LICENSE",
  CERTIFICATION: "CREDENTIAL_CERTIFICATION",
};

const KIND_ORDER: readonly CredentialKind[] = ["IDENTITY", "PROFESSIONAL_LICENSE", "CERTIFICATION"];

export interface RequirementsInput {
  displayName: string | null;
  city: string | null;
  specialties: { category: SpecialtyCategory; active: boolean }[];
  credentials: { kind: CredentialKind; scanStatus: ScanStatus; validUntil: string | null }[];
  /** Hoje em `Africa/Luanda`, `AAAA-MM-DD` (BR-MKT-31). */
  today: string;
}

/** Categorias exigidas = união das categorias das especialidades ligadas (também as inativas: aperto seguro, OP-74). */
export function requiredKinds(specialties: RequirementsInput["specialties"]): CredentialKind[] {
  const kinds = new Set<CredentialKind>();
  for (const specialty of specialties) {
    for (const kind of REQUIRED_CREDENTIALS_BY_CATEGORY[specialty.category]) {
      kinds.add(kind);
    }
  }
  return KIND_ORDER.filter((kind) => kinds.has(kind));
}

/** `valid_until` nulo ou ≥ hoje; datas ISO comparam-se lexicograficamente. */
export function isCredentialExpired(validUntil: string | null, today: string): boolean {
  return validUntil !== null && validUntil < today;
}

/** Lista ordenada e sem duplicados dos requisitos em falta; vazia = pode submeter/aprovar. */
export function deriveRequirements(input: RequirementsInput): ProfessionalRequirement[] {
  const missing: ProfessionalRequirement[] = [];
  const blank = (value: string | null): boolean => value === null || value.trim().length === 0;
  if (blank(input.displayName)) missing.push("DISPLAY_NAME");
  if (blank(input.city)) missing.push("CITY");
  if (!input.specialties.some((s) => s.active)) missing.push("SPECIALTY");

  let pending = false;
  let infected = false;
  let expired = false;
  for (const kind of requiredKinds(input.specialties)) {
    const ofKind = input.credentials.filter((c) => c.kind === kind);
    if (ofKind.some((c) => c.scanStatus === "CLEAN" && !isCredentialExpired(c.validUntil, input.today))) {
      continue;
    }
    if (ofKind.length === 0) {
      missing.push(MISSING_CODE[kind]);
      continue;
    }
    // Todas as causas se reportam (não se mascaram umas às outras): uma credencial nova em verificação NÃO esconde que a anterior caducou
    // (o job de caducidade, BR-MKT-21, depende de `CREDENTIAL_EXPIRED` para retirar o perfil da visibilidade).
    if (ofKind.some((c) => c.scanStatus === "PENDING")) pending = true;
    if (ofKind.some((c) => c.scanStatus === "INFECTED") && !ofKind.some((c) => c.scanStatus === "PENDING")) infected = true;
    if (ofKind.some((c) => c.scanStatus === "CLEAN")) expired = true; // há CLEAN mas nenhuma válida (a válida já teria satisfeito acima)
  }
  if (pending) missing.push("CREDENTIAL_SCAN_PENDING");
  if (infected) missing.push("CREDENTIAL_INFECTED");
  if (expired) missing.push("CREDENTIAL_EXPIRED");
  return missing;
}

/** BR-MKT-21: a falha de requisitos deve-se a caducidade de credencial. */
export function failsByExpiry(missing: readonly ProfessionalRequirement[]): boolean {
  return missing.includes("CREDENTIAL_EXPIRED");
}
