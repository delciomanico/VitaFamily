// Validação do corpo de `POST /clinic-portal/receipts` (BR-CLN-31, `ClinicReceiptInput`). Pura, sem I/O.
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { BOOKING_KINDS, MAX_DESCRIPTION, MAX_LINES, MAX_NOTE, PAYMENT_METHODS, isValidAmountMinor, type PaymentMethod, type ReceiptBookingKind, type RequestedLine } from "./receipt.js";

export interface IssueReceiptInput {
  bookingKind: ReceiptBookingKind;
  bookingId: string;
  paymentMethod: PaymentMethod;
  /** Omitido => uma linha com o serviço do horário da marcação. */
  lines?: RequestedLine[];
  note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIssueReceiptInput(body: unknown): IssueReceiptInput {
  if (!isRecord(body)) {
    throw new ValidationError([{ field: "body", message: "objeto esperado" }], { detail: "Dados inválidos." });
  }
  const errors: FieldError[] = [];
  const bookingKind = BOOKING_KINDS.find((k) => k === body.bookingKind);
  if (!bookingKind) errors.push({ field: "bookingKind", message: BOOKING_KINDS.join(" | ") });
  const bookingId = typeof body.bookingId === "string" && body.bookingId.length > 0 ? body.bookingId : undefined;
  if (!bookingId) errors.push({ field: "bookingId", message: "obrigatório" });
  const paymentMethod = PAYMENT_METHODS.find((m) => m === body.paymentMethod);
  if (!paymentMethod) errors.push({ field: "paymentMethod", message: PAYMENT_METHODS.join(" | ") });

  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    const text = typeof body.note === "string" ? body.note.trim() : undefined;
    if (text === undefined || text.length > MAX_NOTE) errors.push({ field: "note", message: `texto até ${String(MAX_NOTE)} caracteres` });
    else if (text.length > 0) note = text;
  }

  let lines: RequestedLine[] | undefined;
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) {
      errors.push({ field: "lines", message: `entre 1 e ${String(MAX_LINES)} linhas` });
    } else {
      lines = [];
      (body.lines as unknown[]).forEach((raw, index) => {
        const field = `lines[${String(index)}]`;
        if (!isRecord(raw)) {
          errors.push({ field, message: "objeto esperado" });
          return;
        }
        const line: RequestedLine = {};
        if (raw.serviceTypeId !== undefined) {
          if (typeof raw.serviceTypeId !== "string" || raw.serviceTypeId.length === 0) errors.push({ field: `${field}.serviceTypeId`, message: "identificador inválido" });
          else line.serviceTypeId = raw.serviceTypeId;
        }
        if (raw.description !== undefined) {
          const description = typeof raw.description === "string" ? raw.description.trim() : "";
          if (description.length < 1 || description.length > MAX_DESCRIPTION) errors.push({ field: `${field}.description`, message: `entre 1 e ${String(MAX_DESCRIPTION)} caracteres` });
          else line.description = description;
        }
        if (raw.amountMinor !== undefined) {
          if (!isValidAmountMinor(raw.amountMinor)) errors.push({ field: `${field}.amountMinor`, message: "inteiro em cêntimos entre 0 e 100000000000" });
          else line.amountMinor = raw.amountMinor;
        }
        if (line.serviceTypeId && line.description) errors.push({ field, message: "linha do catálogo não leva descrição" });
        if (!line.serviceTypeId && (line.description === undefined || line.amountMinor === undefined) && !errors.some((e) => e.field.startsWith(field))) {
          errors.push({ field, message: "linha livre exige descrição e valor" });
        }
        lines?.push(line);
      });
    }
  }

  if (errors.length > 0 || !bookingKind || !bookingId || !paymentMethod) {
    throw new ValidationError(errors, { detail: "Dados inválidos." });
  }
  return { bookingKind, bookingId, paymentMethod, ...(lines ? { lines } : {}), ...(note ? { note } : {}) };
}
