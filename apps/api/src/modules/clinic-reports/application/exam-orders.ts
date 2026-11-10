// Casos de uso do portal da clínica sobre o pedido de exame (UC-CLN-39..41, BR-CLN-51..54, M15 U, ADR-028).
// Autorização: matriz papel × rota do portal (middleware de `clinics`) + defesa em profundidade aqui (só o Médico escreve; o
// Médico só age nas marcações do seu profissional). Isolamento: tudo filtra pela clínica do token (404 sem enumeração).
// O nome do exame e a nota são dado de saúde: nunca em auditoria, alertas, logs nem erros.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { assertBookingAllowsOrders, assertCancellable, clinicVisibleStatus, EXAM_ORDER_NAME_MAX, MAX_ACTIVE_ORDERS, parseExamOrdersBody, parseExamOrderItems, truncateChars, type ExamOrder, type ExamOrderItem, type ExamOrderStatus } from "../domain/exam-order.js";
import type { ConsultationBookingKind } from "../domain/consultation-report.js";
import { buildExamOrderDocument, examOrderFilename } from "../domain/exam-order-pdf.js";
import type { GeneratedPdf } from "./clinic-reports.js";
import type { BookingFacts, ClinicPortalActor, ClinicReportsDeps, RequestContext } from "./ports.js";
import { assertCanWrite, assertInScope, authorNameOf, bookingResourceType, clinicOrderAudit, consumeLimit, resolveBooking } from "./support.js";

const ORDER_WRITE_DETAIL = "Só o médico pede ou cancela exames.";

/** `components.schemas.ClinicExamOrder` (visão da clínica): sem ids Vita; `SCHEDULED`/`FULFILLED` só se `bookedHere` (BR-CLN-52). */
export interface ClinicExamOrderView {
  id: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  name: string;
  serviceTypeId: string | null;
  note: string | null;
  urgent: boolean;
  status: ExamOrderStatus;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: string;
  authorName: string;
  cancelledAt: string | null;
  createdAt: string;
}

export function toClinicOrderView(order: ExamOrder): ClinicExamOrderView {
  return {
    id: order.id,
    bookingKind: order.bookingKind,
    bookingId: order.bookingId,
    name: order.name,
    serviceTypeId: order.serviceTypeId,
    note: order.note,
    urgent: order.urgent,
    status: clinicVisibleStatus(order),
    patientName: order.patientName,
    patientBirthDate: order.patientBirthDate,
    consultationAt: order.consultationAt.toISOString(),
    authorName: order.authorName,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

/** Resolve o nome de cada item: `name` livre ou o do serviço `EXAM` ativo da própria clínica (truncado a 80). */
async function resolveItemNames<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, clinicId: string, items: ExamOrderItem[]): Promise<{ name: string; serviceTypeId: string | null; note: string | null; urgent: boolean }[]> {
  const resolved: { name: string; serviceTypeId: string | null; note: string | null; urgent: boolean }[] = [];
  for (const [index, item] of items.entries()) {
    if (item.serviceTypeId === null) {
      resolved.push({ name: item.name ?? "", serviceTypeId: null, note: item.note, urgent: item.urgent });
      continue;
    }
    const service = await deps.services.find(trx, clinicId, item.serviceTypeId);
    if (!service) throw new NotFoundError({ detail: "Serviço não encontrado." });
    if (service.kind !== "EXAM" || !service.active) {
      throw new ValidationError([{ field: `items[${String(index)}].serviceTypeId`, message: "tem de ser um serviço de exame ativo" }], { detail: "Serviço inválido para pedido de exame." });
    }
    resolved.push({ name: truncateChars(service.name, EXAM_ORDER_NAME_MAX), serviceTypeId: service.id, note: item.note, urgent: item.urgent });
  }
  return resolved;
}

/**
 * Núcleo partilhado por `POST …/exam-orders` e por `examOrders` de `complete` (mesma transação, `trx` do chamador): valida o
 * âmbito e o estado, serializa o limite de 5 ativos por `pg_advisory_xact_lock(booking)`, grava os pedidos, a ponte (só Vita) e
 * UM alerta genérico por pedido (não por exame). Auditoria `EXAM_ORDER_CREATED` só com contagens (BR-CLN-51/53).
 */
async function createOrders<Trx>(
  deps: ClinicReportsDeps<Trx>,
  trx: Trx,
  actor: ClinicPortalActor,
  kind: ConsultationBookingKind,
  bookingId: string,
  facts: BookingFacts,
  items: ExamOrderItem[],
  viaComplete: boolean,
  context: RequestContext,
): Promise<void> {
  const professionalId = assertCanWrite(actor, ORDER_WRITE_DETAIL);
  await assertInScope(deps, trx, actor, facts);
  assertBookingAllowsOrders(facts.status);
  await deps.ordersRepo.lockBooking(trx, bookingId);
  if ((await deps.ordersRepo.countActive(trx, actor.clinicId, bookingId)) + items.length > MAX_ACTIVE_ORDERS) {
    throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_ACTIVE_ORDERS)} pedidos de exame ativos por marcação.` });
  }
  const resolved = await resolveItemNames(deps, trx, actor.clinicId, items);
  const authorName = await authorNameOf(deps, trx, actor, professionalId);
  const now = deps.clock.now();
  for (const item of resolved) {
    const order = await deps.ordersRepo.insert(trx, {
      id: newId(),
      clinicId: actor.clinicId,
      bookingKind: kind,
      bookingId,
      clinicPatientId: facts.clinicPatientId ?? null,
      name: item.name,
      serviceTypeId: item.serviceTypeId,
      note: item.note,
      urgent: item.urgent,
      patientName: facts.patientName.slice(0, 120),
      patientBirthDate: facts.patientBirthDate ?? null,
      consultationAt: facts.consultationAt,
      authorName,
      authorAccountId: actor.clinicAccountId,
      now,
    });
    if (kind === "APPOINTMENT" && facts.vitaMember) {
      await deps.ordersRepo.insertLink(trx, { orderId: order.id, familyId: facts.vitaMember.familyId, memberId: facts.vitaMember.memberId, appointmentId: bookingId }, now);
    }
  }
  if (kind === "APPOINTMENT" && facts.vitaMember) {
    await deps.orderAlerts.raiseExamOrderAdded(trx, { appointmentId: bookingId, familyId: facts.vitaMember.familyId, memberId: facts.vitaMember.memberId });
  }
  await deps.audit.record(
    trx,
    clinicOrderAudit(actor, now, "EXAM_ORDER_CREATED", bookingResourceType(kind), bookingId, context, { bookingKind: kind, count: items.length, urgentCount: items.filter((i) => i.urgent).length, viaComplete }),
  );
}

/** `POST /clinic-portal/agenda/{id}/exam-orders` (UC-CLN-39): devolve a lista completa da marcação. */
export function createCreateExamOrdersUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function createExamOrders(actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext): Promise<ClinicExamOrderView[]> {
    assertCanWrite(actor, ORDER_WRITE_DETAIL);
    consumeLimit(deps.limiter, "order-write", actor.clinicAccountId);
    const items = parseExamOrdersBody(body);
    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await createOrders(deps, trx, actor, booking.kind, bookingId, booking.facts, items, false, context);
      return (await deps.ordersRepo.listByBooking(trx, actor.clinicId, bookingId)).map(toClinicOrderView);
    });
  };
}

/**
 * `examOrders` em `PUT …/complete` (BR-CLN-51): cria os pedidos NA transação da conclusão (`trx` do chamador). Admin/Gestor =>
 * `FORBIDDEN` (a transação do chamador reverte: sem efeito parcial). Implementa a porta de `appointments` (ligada em `main/api.ts`).
 */
export function createCreateWithCompleteUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function createWithComplete(trx: Trx, actor: ClinicPortalActor, kind: ConsultationBookingKind, bookingId: string, examOrders: unknown, context: RequestContext): Promise<void> {
    assertCanWrite(actor, ORDER_WRITE_DETAIL);
    const items = parseExamOrderItems(examOrders, "examOrders");
    const facts = await deps.bookings.find(trx, actor.clinicId, kind, bookingId);
    if (!facts) throw new NotFoundError({ detail: "Marcação não encontrada." });
    await createOrders(deps, trx, actor, kind, bookingId, facts, items, true, context);
  };
}

/** `GET /clinic-portal/agenda/{id}/exam-orders` (UC-CLN-41): Admin/Gestor qualquer marcação da clínica; o Médico as suas. */
async function loadReadable<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, bookingId: string): Promise<{ kind: ConsultationBookingKind; orders: ExamOrder[] }> {
  const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
  if (booking) {
    await assertInScope(deps, trx, actor, booking.facts);
    return { kind: booking.kind, orders: await deps.ordersRepo.listByBooking(trx, actor.clinicId, bookingId) };
  }
  // Marcação Vita já apagada: os pedidos sobrevivem (BR-CLN-56); o Médico não consegue provar o âmbito => 404.
  if (actor.role === "CLINIC_DOCTOR") throw new NotFoundError({ detail: "Marcação não encontrada." });
  const orders = await deps.ordersRepo.listByBooking(trx, actor.clinicId, bookingId);
  const first = orders[0];
  if (!first) throw new NotFoundError({ detail: "Marcação não encontrada." });
  return { kind: first.bookingKind, orders };
}

export function createListExamOrdersUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function listExamOrders(actor: ClinicPortalActor, bookingId: string, context: RequestContext): Promise<ClinicExamOrderView[]> {
    return deps.withTransaction(async (trx) => {
      const { kind, orders } = await loadReadable(deps, trx, actor, bookingId);
      await deps.audit.record(trx, clinicOrderAudit(actor, deps.clock.now(), "EXAM_ORDER_VIEWED", bookingResourceType(kind), bookingId, context, { bookingKind: kind, format: "JSON" }));
      return orders.map(toClinicOrderView);
    });
  };
}

/** `PUT …/exam-orders/{orderId}/cancel` (UC-CLN-40): idempotente; não toca no `Examination` do paciente. */
export function createCancelExamOrderUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function cancelExamOrder(actor: ClinicPortalActor, bookingId: string, orderId: string, context: RequestContext): Promise<ClinicExamOrderView> {
    assertCanWrite(actor, ORDER_WRITE_DETAIL);
    consumeLimit(deps.limiter, "order-write", actor.clinicAccountId);
    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await assertInScope(deps, trx, actor, booking.facts);
      const order = await deps.ordersRepo.findById(trx, actor.clinicId, bookingId, orderId, true);
      if (!order) throw new NotFoundError({ detail: "Pedido de exame não encontrado." });
      if (assertCancellable(order) === "ALREADY_CANCELLED") return toClinicOrderView(order);
      const now = deps.clock.now();
      const cancelled = await deps.ordersRepo.cancel(trx, actor.clinicId, orderId, actor.clinicAccountId, now);
      await deps.audit.record(trx, clinicOrderAudit(actor, now, "EXAM_ORDER_CANCELLED", "ExamOrder", orderId, context, { bookingKind: booking.kind }));
      return toClinicOrderView(cancelled);
    });
  };
}

/** `GET …/exam-orders/pdf` (BR-CLN-54): gerado a pedido com os pedidos ATIVOS; não é guardado; 30/min por conta (bolsa partilhada). */
export function createGetExamOrdersPdfUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getExamOrdersPdf(actor: ClinicPortalActor, bookingId: string, context: RequestContext): Promise<GeneratedPdf> {
    consumeLimit(deps.limiter, "pdf", actor.clinicAccountId);
    return deps.withTransaction(async (trx) => {
      const { kind, orders } = await loadReadable(deps, trx, actor, bookingId);
      const active = orders.filter((o) => o.status !== "CANCELLED");
      const first = active[0];
      if (!first) throw new NotFoundError({ detail: "Sem pedidos de exame ativos." });
      const { issuer } = await deps.profile.get(trx, actor.clinicId);
      const now = deps.clock.now();
      const bytes = await deps.pdf.render(buildExamOrderDocument(active, issuer, now));
      await deps.audit.record(trx, clinicOrderAudit(actor, now, "EXAM_ORDER_VIEWED", bookingResourceType(kind), bookingId, context, { bookingKind: kind, format: "PDF" }));
      return { bytes, filename: examOrderFilename(first.consultationAt) };
    });
  };
}

/** Pedidos não cancelados por marcação (decora `ClinicBooking.examOrderCount`); API pública para `appointments`. */
export function createExamOrderCountsUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return function examOrderCounts(trx: Trx, clinicId: string, bookingIds: string[]) {
    return bookingIds.length === 0 ? Promise.resolve(new Map<string, number>()) : deps.ordersRepo.activeCountsByBookings(trx, clinicId, bookingIds);
  };
}

/** Pedidos não cancelados por consulta Vita (decora `Appointment.examOrderCount`); API pública para `appointments`. */
export function createAppointmentExamOrderCountsUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return function appointmentExamOrderCounts(trx: Trx, appointmentIds: string[]) {
    return appointmentIds.length === 0 ? Promise.resolve(new Map<string, number>()) : deps.ordersRepo.activeCountsByAppointments(trx, appointmentIds);
  };
}
