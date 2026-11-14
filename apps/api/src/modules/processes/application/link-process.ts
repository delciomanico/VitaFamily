// `ProcessLinker.open` / `.discard` (UC-PRC-01/02, BR-PRC-01/07/11): chamados pelos módulos donos dos atos
// DENTRO da transação do ato (a que reverte se isto falhar). A porta é definida em cada dono; aqui só se
// implementa (ligada em `main/api.ts`).
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { kindOfOrigin } from "../domain/process.js";
import type { DiscardProcessInput, OpenProcessInput, ProcessActor, ProcessesDeps } from "./ports.js";

function actorFields(by: ProcessActor) {
  return {
    actorType: by.actorType,
    requestId: by.requestId,
    ...(by.actorUserId ? { actorUserId: by.actorUserId } : {}),
    ...(by.actorClinicAccountId ? { actorClinicAccountId: by.actorClinicAccountId } : {}),
    ...auditContextFields(by),
  };
}

export function createOpenProcessUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function openProcess(trx: Trx, input: OpenProcessInput): Promise<{ processId: string }> {
    const now = deps.clock.now();
    const { process, created } = await deps.repo.insertIfAbsent(trx, {
      id: newId(),
      familyId: input.familyId,
      memberId: input.memberId,
      kind: kindOfOrigin(input.originType),
      originType: input.originType,
      originId: input.originId,
      openedAt: now,
      ...(input.clinicId ? { clinicId: input.clinicId } : {}),
    });

    // Idempotente: só a abertura efetiva é auditada.
    if (created) {
      await deps.audit.record(trx, {
        occurredAt: now,
        ...actorFields(input.by),
        action: "PROCESS_OPEN",
        resourceType: "Process",
        resourceId: process.id,
        familyId: input.familyId,
        subjectMemberId: input.memberId,
        result: "SUCCESS",
        metadata: { originType: input.originType, kind: process.kind },
      });
    }
    return { processId: process.id };
  };
}

export function createDiscardProcessUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function discardProcess(trx: Trx, input: DiscardProcessInput): Promise<void> {
    const removed = await deps.repo.deleteByOrigin(trx, input.originType, input.originId);
    if (!removed) {
      return;
    }
    await deps.audit.record(trx, {
      occurredAt: deps.clock.now(),
      ...actorFields(input.by),
      action: "PROCESS_DISCARD",
      resourceType: "Process",
      resourceId: removed.id,
      familyId: removed.familyId,
      subjectMemberId: removed.memberId,
      result: "SUCCESS",
      metadata: { originType: input.originType },
    });
  };
}

/** `ProcessLinker.findForClinic` (fatia 3, BR-AUT-01): só leitura; valida o `processId` de um pedido (da clínica do token). */
export function createFindProcessForClinicUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function findProcessForClinic(trx: Trx, input: { clinicId: string; processId: string }): Promise<{ processId: string; familyId: string; memberId: string } | null> {
    const process = await deps.repo.findOfClinic(trx, input.clinicId, input.processId);
    return process ? { processId: process.id, familyId: process.familyId, memberId: process.memberId } : null;
  };
}
