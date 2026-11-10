// Pedido de exame — lado família (UC-CLN-42, BR-CLN-52/53, authorization.md §6.7, M15 U) e porta `ExamOrderLinker` (modules.md §2
// nota 28). Autorização pela porta `PatientAccessPort` (`AccessPolicy.can(VIEW_EXAM_ORDERS)`: só SELF adulto ou TUTOR_OF;
// DEPENDENT_SELF e OTHER => FORBIDDEN mesmo com SharingGrant). Independente de `ClinicConsent`. Sem ids da conta autora.
import { ConflictError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ExamOrderStatus } from "../domain/exam-order.js";
import type { ActorIdentity, ClinicReportsDeps, RequestContext } from "./ports.js";

/** `components.schemas.FamilyExamOrder`. */
export interface FamilyExamOrderView {
  id: string;
  appointmentId: string;
  clinicId: string;
  clinicName: string;
  name: string;
  note: string | null;
  urgent: boolean;
  status: ExamOrderStatus;
  examinationId: string | null;
  orderedAt: string;
}

export interface ListFamilyExamOrdersQuery {
  status?: ExamOrderStatus;
  appointmentId?: string;
}

/** `GET /families/{f}/members/{m}/exam-orders`: por omissão exclui `CANCELLED`. Leitura não auditada (como o relatório do titular). */
export function createListFamilyExamOrdersUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function listFamilyExamOrders(actor: ActorIdentity, familyId: string, memberId: string, query: ListFamilyExamOrdersQuery = {}): Promise<FamilyExamOrderView[]> {
    return deps.withTransaction(async (trx) => {
      await deps.patientAccess.assertCanViewExamOrders(trx, actor, familyId, memberId);
      const rows = await deps.ordersRepo.listForMember(trx, familyId, memberId, query);
      const names = new Map<string, string>();
      for (const clinicId of new Set(rows.map((r) => r.clinicId))) names.set(clinicId, (await deps.profile.get(trx, clinicId)).issuer.name);
      return rows.map((r) => ({
        id: r.id,
        appointmentId: r.appointmentId,
        clinicId: r.clinicId,
        clinicName: names.get(r.clinicId) ?? "",
        name: r.name,
        note: r.note,
        urgent: r.urgent,
        status: r.status,
        examinationId: r.examinationId,
        orderedAt: r.createdAt.toISOString(),
      }));
    });
  };
}

export interface LinkExamOrderInput {
  actor: ActorIdentity;
  familyId: string;
  memberId: string;
  orderId: string;
  examinationId: string;
  /** Clínica do exame; `booked_here` = igual à do pedido (BR-CLN-52). Ausente = exame privado/sem clínica. */
  examClinicId?: string;
  /** Estado com que o exame nasce. */
  status: "SCHEDULED" | "COMPLETED";
}

/**
 * Implementa `ExamOrderLinker` de `examinations` (ligada em `main/api.ts`); todas as operações correm na transação do exame.
 * `link`: o pedido tem de ser do MESMO membro e visível ao ator (`VIEW_EXAM_ORDERS`; senão `NOT_FOUND`) e `ORDERED` (senão `CONFLICT`).
 */
export function createExamOrderLinker<Trx>(deps: ClinicReportsDeps<Trx>) {
  return {
    async link(trx: Trx, input: LinkExamOrderInput, context: RequestContext): Promise<void> {
      await deps.patientAccess.assertCanViewExamOrders(trx, input.actor, input.familyId, input.memberId);
      const found = await deps.ordersRepo.findLinkedForUpdate(trx, input.familyId, input.memberId, input.orderId);
      if (!found) throw new NotFoundError({ detail: "Pedido de exame não encontrado." });
      if (found.order.status !== "ORDERED") throw new ConflictError({ detail: "O pedido de exame já não está por marcar." });
      const now = deps.clock.now();
      await deps.ordersRepo.setLinked(trx, input.orderId, input.examinationId, input.status === "COMPLETED" ? "FULFILLED" : "SCHEDULED", input.examClinicId === found.order.clinicId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: input.actor.userId,
        action: "EXAM_ORDER_LINKED",
        resourceType: "ExamOrder",
        resourceId: input.orderId,
        familyId: input.familyId,
        subjectMemberId: input.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { examinationId: input.examinationId },
      });
    },
    /** Exame cancelado/apagado: pedido de novo `ORDERED` (idempotente; sem ligação não faz nada). */
    async release(trx: Trx, examinationId: string): Promise<void> {
      await deps.ordersRepo.releaseByExamination(trx, examinationId, deps.clock.now());
    },
    /** Exame `COMPLETED`: pedido `FULFILLED` (idempotente). */
    async fulfil(trx: Trx, examinationId: string): Promise<void> {
      await deps.ordersRepo.fulfilByExamination(trx, examinationId, deps.clock.now());
    },
  };
}
