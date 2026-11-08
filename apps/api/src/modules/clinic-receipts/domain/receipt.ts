// Recibo interno não fiscal da clínica (M14 R, BR-CLN-31..34, state-machines.md `ClinicReceipt`). Regras puras, sem I/O.
// Dinheiro sempre em inteiros em cêntimos; o recibo é imutável salvo a anulação (`ISSUED -> VOIDED`, irreversível).
import { DomainError, ValidationError, type FieldError } from "../../../platform/errors/index.js";

export type ReceiptBookingKind = "APPOINTMENT" | "EXAM" | "VISIT";
export type ReceiptStatus = "ISSUED" | "VOIDED";
export type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "INSURANCE";

export const BOOKING_KINDS: readonly ReceiptBookingKind[] = ["APPOINTMENT", "EXAM", "VISIT"];
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "CARD", "TRANSFER", "INSURANCE"];

/** Texto fixo obrigatório de todo o recibo (BR-CLN-31). */
export const RECEIPT_NOTICE = "Documento não fiscal — não substitui fatura";
export const MAX_AMOUNT_MINOR = 100_000_000_000;
export const MAX_LINES = 20;
export const MAX_DESCRIPTION = 120;
export const MAX_NOTE = 200;
export const MIN_VOID_REASON = 3;
export const MAX_VOID_REASON = 200;
export const MAX_PATIENT_NAME = 120;

export interface ReceiptLine {
  position: number;
  description: string;
  amountMinor: number;
  serviceTypeId: string | null;
}

export interface ReceiptIssuer {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ClinicReceipt {
  id: string;
  clinicId: string;
  number: number;
  bookingKind: ReceiptBookingKind;
  bookingId: string;
  status: ReceiptStatus;
  paymentMethod: PaymentMethod;
  currency: string;
  totalMinor: number;
  patientName: string;
  note: string | null;
  issuer: ReceiptIssuer;
  lines: ReceiptLine[];
  issuedAt: Date;
  issuedByClinicAccountId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedByClinicAccountId: string | null;
}

/** BR-CLN-32: apresentação `R-` + 6 dígitos (`R-000123`). */
export function formatReceiptNumber(number: number): string {
  return `R-${String(number).padStart(6, "0")}`;
}

export function isValidAmountMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR;
}

/** Linha pedida: do catálogo (`serviceTypeId`, `amountMinor?` ajusta) ou livre (`description` + `amountMinor`). */
export interface RequestedLine {
  serviceTypeId?: string;
  description?: string;
  amountMinor?: number;
}

/** Serviço do catálogo da clínica (só o necessário para a linha). */
export interface CatalogService {
  id: string;
  name: string;
  priceMinor: number | null;
}

/**
 * Constrói as linhas finais (BR-CLN-31/34): linha de catálogo = nome do serviço + preço (ou valor ajustado); sem preço
 * nem ajuste => `VALIDATION_ERROR`; total > 0 e ≤ 10¹¹ calculado aqui (nunca vem do cliente).
 */
export function buildReceiptLines(requested: RequestedLine[], services: ReadonlyMap<string, CatalogService>): { lines: ReceiptLine[]; totalMinor: number } {
  const errors: FieldError[] = [];
  const lines: ReceiptLine[] = [];
  requested.forEach((line, index) => {
    const field = `lines[${String(index)}]`;
    if (line.serviceTypeId) {
      const service = services.get(line.serviceTypeId);
      if (!service) {
        errors.push({ field, message: "serviço do catálogo desconhecido" });
        return;
      }
      const amount = line.amountMinor ?? service.priceMinor;
      if (amount === null) {
        errors.push({ field: `${field}.amountMinor`, message: "o serviço não tem preço; indique o valor" });
        return;
      }
      lines.push({ position: index + 1, description: service.name.slice(0, MAX_DESCRIPTION), amountMinor: amount, serviceTypeId: service.id });
      return;
    }
    if (!line.description || line.amountMinor === undefined) {
      errors.push({ field, message: "linha livre exige descrição e valor" });
      return;
    }
    lines.push({ position: index + 1, description: line.description, amountMinor: line.amountMinor, serviceTypeId: null });
  });
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Linhas do recibo inválidas." });
  }
  const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (totalMinor <= 0 || totalMinor > MAX_AMOUNT_MINOR) {
    throw new ValidationError([{ field: "lines", message: "o total tem de ser maior que 0" }], { detail: "Total do recibo inválido." });
  }
  return { lines, totalMinor };
}

/** BR-CLN-33: só `ISSUED` se anula; repetir => `INVALID_STATE_TRANSITION`. */
export function assertCanVoid(status: ReceiptStatus): void {
  if (status !== "ISSUED") {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O recibo já está anulado." });
  }
}

export function parseVoidReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < MIN_VOID_REASON || reason.length > MAX_VOID_REASON) {
    throw new ValidationError([{ field: "reason", message: `entre ${String(MIN_VOID_REASON)} e ${String(MAX_VOID_REASON)} caracteres` }], { detail: "Motivo inválido." });
  }
  return reason;
}
