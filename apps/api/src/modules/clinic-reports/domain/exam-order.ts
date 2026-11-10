// Entidade pura `ExamOrder` (entities.md, M15 U, ADR-028, BR-CLN-51..56) e declaração de presença (M15 V, BR-CLN-55). Sem I/O.
// O nome do exame e a nota são DADO DE SAÚDE (BR-HLT-05): nunca vão para logs, auditoria, alertas nem mensagens de erro.
import { DomainError, ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { charLength, type ConsultationBookingKind } from "./consultation-report.js";

export type ExamOrderStatus = "ORDERED" | "SCHEDULED" | "FULFILLED" | "CANCELLED";

export interface ExamOrder {
  id: string;
  clinicId: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  clinicPatientId: string | null;
  name: string;
  serviceTypeId: string | null;
  note: string | null;
  urgent: boolean;
  status: ExamOrderStatus;
  /** O exame ligado é da própria clínica do pedido (BR-CLN-52): só então a clínica vê `SCHEDULED`/`FULFILLED`. */
  bookedHere: boolean;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: Date;
  authorName: string;
  authorAccountId: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const EXAM_ORDER_NAME_MAX = 80;
export const EXAM_ORDER_NOTE_MAX = 200;
/** BR-CLN-51: itens por pedido e pedidos ativos por marcação. */
export const MAX_ORDERS_PER_REQUEST = 5;
export const MAX_ACTIVE_ORDERS = 5;
export const EXAM_ORDER_NOTICE = "Documento não fiscal. Não substitui receita médica nem atestado.";
export const ATTENDANCE_NOTICE = "Documento não fiscal. Não é atestado médico nem comprova a existência de doença.";

/** Item validado de `ExamOrderItemInput`: exatamente um de `name` e `serviceTypeId`. */
export interface ExamOrderItem {
  name: string | null;
  serviceTypeId: string | null;
  note: string | null;
  urgent: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_KEYS = new Set(["name", "serviceTypeId", "note", "urgent"]);

/** Texto de uma linha: qualquer caracter de controlo (incl. quebra de linha), DEL e C1 é rejeitado (BR-CLN-51). */
function hasControlChars(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function singleLine(value: unknown, field: string, max: number, errors: FieldError[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push({ field, message: "tem de ser texto" });
    return null;
  }
  const text = value.trim();
  if (text === "") return null;
  if (hasControlChars(text)) {
    errors.push({ field, message: "contém caracteres de controlo" });
    return null;
  }
  if (charLength(text) > max) {
    errors.push({ field, message: `no máximo ${String(max)} caracteres` });
    return null;
  }
  return text;
}

/** Trunca a `max` pontos de código (nome copiado do catálogo, BR-CLN-51). */
export function truncateChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/** `items` de `ClinicExamOrdersInput` / `examOrders` de `complete` (BR-CLN-51): 1–5 itens, campos desconhecidos rejeitados. */
export function parseExamOrderItems(raw: unknown, field: string): ExamOrderItem[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ORDERS_PER_REQUEST) {
    throw new ValidationError([{ field, message: `entre 1 e ${String(MAX_ORDERS_PER_REQUEST)} exames` }], { detail: "Pedido de exame inválido." });
  }
  const errors: FieldError[] = [];
  const items = raw.map((entry, index): ExamOrderItem => {
    const where = `${field}[${String(index)}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push({ field: where, message: "objeto esperado" });
      return { name: null, serviceTypeId: null, note: null, urgent: false };
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ITEM_KEYS.has(key)) errors.push({ field: `${where}.${key}`, message: "campo desconhecido" });
    }
    const name = singleLine(record.name, `${where}.name`, EXAM_ORDER_NAME_MAX, errors);
    let serviceTypeId: string | null = null;
    if (record.serviceTypeId !== undefined && record.serviceTypeId !== null) {
      if (typeof record.serviceTypeId === "string" && UUID.test(record.serviceTypeId)) serviceTypeId = record.serviceTypeId;
      else errors.push({ field: `${where}.serviceTypeId`, message: "uuid inválido" });
    }
    if ((name === null) === (serviceTypeId === null) && !errors.some((e) => e.field.startsWith(where))) {
      errors.push({ field: where, message: "indique o nome ou o serviço de exame (um dos dois)" });
    }
    const note = singleLine(record.note, `${where}.note`, EXAM_ORDER_NOTE_MAX, errors);
    let urgent = false;
    if (record.urgent !== undefined && record.urgent !== null) {
      if (typeof record.urgent === "boolean") urgent = record.urgent;
      else errors.push({ field: `${where}.urgent`, message: "tem de ser booleano" });
    }
    return { name, serviceTypeId, note, urgent };
  });
  if (errors.length > 0) throw new ValidationError(errors, { detail: "Pedido de exame inválido." });
  return items;
}

/** `ClinicExamOrdersInput` (`POST …/exam-orders`): `{ items }` e nada mais. */
export function parseExamOrdersBody(body: unknown): ExamOrderItem[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: "items", message: "obrigatório" }], { detail: "Pedido de exame inválido." });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => key !== "items");
  if (extra.length > 0) throw new ValidationError(extra.map((field) => ({ field, message: "campo desconhecido" })), { detail: "Pedido de exame inválido." });
  return parseExamOrderItems(record.items, "items");
}

/** BR-CLN-51: só marcações `SCHEDULED` ou `COMPLETED` admitem pedidos de exame. */
export function assertBookingAllowsOrders(status: string): void {
  if (status !== "SCHEDULED" && status !== "COMPLETED") {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Só consultas em curso ou concluídas admitem pedidos de exame." });
  }
}

/** BR-CLN-52: `SCHEDULED`/`FULFILLED` só se o exame ligado é da própria clínica; senão `ORDERED` (`CANCELLED` é sempre visível). */
export function clinicVisibleStatus(order: Pick<ExamOrder, "status" | "bookedHere">): ExamOrderStatus {
  if (order.status === "CANCELLED") return "CANCELLED";
  return order.bookedHere ? order.status : "ORDERED";
}

/** BR-CLN-52: cancelar só a partir de `ORDERED`/`SCHEDULED` como a clínica os vê; `FULFILLED` visível => 409. `true` = já cancelado (idempotente). */
export function assertCancellable(order: Pick<ExamOrder, "status" | "bookedHere">): "ALREADY_CANCELLED" | "CANCEL" {
  const visible = clinicVisibleStatus(order);
  if (visible === "CANCELLED") return "ALREADY_CANCELLED";
  if (visible === "FULFILLED") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido já foi cumprido nesta clínica." });
  return "CANCEL";
}

/** BR-CLN-55: declaração só de marcação `COMPLETED` ou `SCHEDULED` com chegada registada. */
export function assertAttendanceEligible(status: string, arrivedAt: Date | undefined): void {
  if (status === "COMPLETED" || (status === "SCHEDULED" && arrivedAt !== undefined)) return;
  throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A declaração de presença exige uma consulta concluída ou com a chegada registada." });
}
