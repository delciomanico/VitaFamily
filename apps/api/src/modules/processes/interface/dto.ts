// Mapeamento das vistas da `application` para a forma da API (components.schemas.Process / ProcessPage /
// ClinicProcess, openapi.yaml). Enumerações em inglês; a tradução ("Marcado / A tratar…") é da UI (BR-PRC-03).
import type { Page } from "../../../platform/page/index.js";
import type { ClinicProcessView, ProcessView } from "../application/process-view.js";

export function toProcessResponse(view: ProcessView) {
  return {
    id: view.id,
    memberId: view.memberId,
    kind: view.kind,
    familyStatus: view.familyStatus,
    nextStep: { code: view.nextStep.code, actor: view.nextStep.actor, ...(view.nextStep.dueAt ? { dueAt: view.nextStep.dueAt.toISOString() } : {}) },
    origin: { type: view.origin.type, id: view.origin.id },
    scheduledAt: view.scheduledAt,
    openedAt: view.openedAt,
  };
}

export function toProcessPageResponse(page: Page<ProcessView>) {
  return { items: page.items.map(toProcessResponse), nextCursor: page.nextCursor };
}

export function toClinicProcessResponse(view: ClinicProcessView) {
  return { id: view.id, kind: view.kind, origin: { type: view.origin.type, id: view.origin.id }, phase: view.phase, openedAt: view.openedAt };
}
