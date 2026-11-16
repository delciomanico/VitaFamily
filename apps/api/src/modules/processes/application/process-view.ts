// Vistas de resposta (components.schemas.Process / ClinicProcess) e a montagem a partir de processo + factos.
import { deriveFamilyStatus } from "../domain/derive-family-status.js";
import { hasAct, type ActFact, type ActPhase, type FamilyStatus, type NextStep, type Process, type ProcessKind, type ProcessOriginType } from "../domain/process.js";
import type { LoadedFacts } from "./load-facts.js";

/** `Process` do contrato (família): `familyStatus`/`nextStep` derivados em leitura, nunca persistidos (BR-PRC-02/03). */
export interface ProcessView {
  id: string;
  memberId: string;
  kind: ProcessKind;
  familyStatus: FamilyStatus;
  nextStep: NextStep;
  origin: { type: ProcessOriginType; id: string };
  scheduledAt: string | null;
  openedAt: string;
}

/** `ClinicProcess` do contrato (BR-PRC-06): sem ids Vita, `familyStatus` nem `nextStep`. */
export interface ClinicProcessView {
  id: string;
  kind: ProcessKind;
  origin: { type: ProcessOriginType; id: string };
  phase: ActPhase;
  openedAt: string;
}

/** Factos legíveis de um processo: o ato. */
export interface ReadableFacts {
  act: ActFact;
}

export function toProcessView(process: Process, facts: ReadableFacts): ProcessView {
  const { familyStatus, nextStep } = deriveFamilyStatus(facts);
  return {
    id: process.id,
    memberId: process.memberId,
    kind: process.kind,
    familyStatus,
    nextStep,
    origin: { type: process.originType, id: process.originId },
    scheduledAt: facts.act.scheduledAt ? facts.act.scheduledAt.toISOString() : null,
    openedAt: process.openedAt.toISOString(),
  };
}

export function toClinicProcessView(process: Process, facts: ReadableFacts): ClinicProcessView {
  return {
    id: process.id,
    kind: process.kind,
    origin: { type: process.originType, id: process.originId },
    phase: facts.act.phase,
    openedAt: process.openedAt.toISOString(),
  };
}

/** Os factos de um processo, ou `undefined` se a origem não é legível (BR-PRC-09: ato inexistente). */
export function readableFactsOf(process: Process, loaded: LoadedFacts): ReadableFacts | undefined {
  if (!hasAct(process.originType)) return undefined;
  const act = loaded.acts.get(`${process.originType}:${process.originId}`);
  return act === undefined ? undefined : { act };
}
