// Beneficiário da seguradora (entities.md `Beneficiary`, state-machines.md, BR-SEG-01/17/20). Entidade e regras puras;
// `node:crypto` é computação pura (conventions.md §3.2). Dados da seguradora: nunca ids de família/membro (só `linked`).
import { createHmac, randomInt } from "node:crypto";
import { DomainError } from "../../../platform/errors/index.js";
import { fail, requireIsoDate, requireNote, requireText } from "./validation.js";

export type BeneficiaryStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type BeneficiaryRelationship = "HOLDER" | "SPOUSE" | "CHILD" | "OTHER";
export const RELATIONSHIPS: BeneficiaryRelationship[] = ["HOLDER", "SPOUSE", "CHILD", "OTHER"];
export const BENEFICIARY_STATUSES: BeneficiaryStatus[] = ["PENDING", "ACTIVE", "SUSPENDED", "CANCELLED"];

export interface Beneficiary {
  id: string;
  insurerId: string;
  companyId: string | null;
  holderId: string | null;
  name: string;
  idDocumentType: string;
  idDocumentNumber: string;
  birthDate: string;
  relationship: BeneficiaryRelationship;
  cardNumber: string;
  cardVersion: number;
  status: BeneficiaryStatus;
  /** Existe ligação confirmada a um paciente (BR-SEG-20) — o único dado do lado do paciente que sai da seguradora. */
  linked: boolean;
  /** Nota da última passagem a SUSPENDED/CANCELLED (BR-SEG-24). */
  statusNote: string | null;
  createdAt: Date;
}

export interface BeneficiaryInput {
  companyId?: unknown;
  holderId?: unknown;
  name?: unknown;
  idDocumentType?: unknown;
  idDocumentNumber?: unknown;
  birthDate?: unknown;
  relationship?: unknown;
}

export interface ParsedBeneficiaryInput {
  companyId: string | null;
  holderId: string | null;
  name: string;
  idDocumentType: string;
  idDocumentNumber: string;
  birthDate: string;
  relationship: BeneficiaryRelationship;
}

export function normalizeDocumentType(value: unknown): string {
  return requireText(value, "idDocumentType", 40).toUpperCase();
}

export function isRelationship(value: unknown): value is BeneficiaryRelationship {
  return typeof value === "string" && (RELATIONSHIPS as string[]).includes(value);
}

/** BR-SEG-17/UC-SEG-02: `relationship=HOLDER ⇔ sem holderId`. */
export function parseBeneficiaryInput(input: BeneficiaryInput): ParsedBeneficiaryInput {
  if (!isRelationship(input.relationship)) fail("relationship", "HOLDER, SPOUSE, CHILD ou OTHER");
  const holderId = typeof input.holderId === "string" ? input.holderId : null;
  if (input.relationship === "HOLDER" && holderId !== null) fail("holderId", "proibido para o titular");
  if (input.relationship !== "HOLDER" && holderId === null) fail("holderId", "obrigatório para dependentes");
  return {
    companyId: typeof input.companyId === "string" ? input.companyId : null,
    holderId,
    name: requireText(input.name, "name", 200),
    idDocumentType: normalizeDocumentType(input.idDocumentType),
    idDocumentNumber: requireText(input.idDocumentNumber, "idDocumentNumber", 60),
    birthDate: requireIsoDate(input.birthDate, "birthDate"),
    relationship: input.relationship,
  };
}

export interface BeneficiaryPatch {
  name?: string;
  birthDate?: string;
  /** `null` desliga a empresa. */
  companyId?: string | null;
}

/** UC-SEG-02: só nome, data de nascimento e empresa (documento e relação não se alteram). */
export function parseBeneficiaryPatch(input: { name?: unknown; birthDate?: unknown; companyId?: unknown }): BeneficiaryPatch {
  const patch: BeneficiaryPatch = {};
  if (input.name !== undefined) patch.name = requireText(input.name, "name", 200);
  if (input.birthDate !== undefined) patch.birthDate = requireIsoDate(input.birthDate, "birthDate");
  if (input.companyId !== undefined) {
    if (input.companyId !== null && typeof input.companyId !== "string") fail("companyId", "uuid ou null");
    patch.companyId = input.companyId;
  }
  return patch;
}

const TRANSITIONS: Record<BeneficiaryStatus, BeneficiaryStatus[]> = {
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
};

/** state-machines.md «Beneficiary»; `SUSPENDED`/`CANCELLED` exigem nota; `CANCELLED` é final. */
export function assertBeneficiaryTransition(from: BeneficiaryStatus, to: unknown, note: unknown): BeneficiaryStatus {
  if (to !== "ACTIVE" && to !== "SUSPENDED" && to !== "CANCELLED") fail("status", "ACTIVE, SUSPENDED ou CANCELLED");
  if (to === "SUSPENDED" || to === "CANCELLED") requireNote(note);
  if (!TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado não permitida." });
  }
  return to;
}

/** Nº de cartão gerado pelo servidor (não sequencial, não adivinhável): `VF` + 14 dígitos. */
export function generateCardNumber(): string {
  let digits = "";
  for (let i = 0; i < 14; i++) digits += String(randomInt(10));
  return `VF${digits}`;
}

// --- Código de reclamação do cartão (BR-SEG-20; `insurer_beneficiaries.claim_code_hash`) ---
// Mesmo formato do código de ligação da clínica (BR-CLN-20): 8 caracteres, alfabeto sem 0 O 1 I L. A validade não está
// fixada na documentação: 7 dias (pressuposto, a ratificar) — a seguradora entrega o código fora do sistema.
export const CLAIM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CLAIM_CODE_LENGTH = 8;
export const CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateClaimCode(): string {
  let code = "";
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) code += CLAIM_CODE_ALPHABET.charAt(randomInt(CLAIM_CODE_ALPHABET.length));
  return code;
}

/** HMAC-SHA256 do código normalizado (maiúsculas, sem hífen), com separação de domínio face aos códigos da clínica. */
export function hashClaimCode(secret: string, code: string): string {
  const normalized = code.replace(/[-\s]/g, "").toUpperCase();
  return createHmac("sha256", secret).update(`insurer-claim-code:${normalized}`, "utf8").digest("hex");
}

/** Apresentação `XXXX-XXXX`. */
export function formatClaimCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
