// Vistas de resposta (components.schemas.Process / ClinicProcess) e a montagem a partir de processo + facto do ato.
import { deriveFamilyStatus } from "../domain/derive-family-status.js";
import type { ActFact, ActPhase, FamilyStatus, NextStep, Process, ProcessKind, ProcessOriginType } from "../domain/process.js";
import type { ActFactEntry, ActFactRef } from "./ports.js";

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

export function toProcessView(process: Process, fact: ActFact): ProcessView {
  const { familyStatus, nextStep } = deriveFamilyStatus({ act: fact });
  return {
    id: process.id,
    memberId: process.memberId,
    kind: process.kind,
    familyStatus,
    nextStep,
    origin: { type: process.originType, id: process.originId },
    scheduledAt: fact.scheduledAt ? fact.scheduledAt.toISOString() : null,
    openedAt: process.openedAt.toISOString(),
  };
}

export function toClinicProcessView(process: Process, fact: ActFact): ClinicProcessView {
  return {
    id: process.id,
    kind: process.kind,
    origin: { type: process.originType, id: process.originId },
    phase: fact.phase,
    openedAt: process.openedAt.toISOString(),
  };
}

export function refOf(process: Process): ActFactRef {
  return { originType: process.originType, originId: process.originId };
}

/** Índice dos factos por ato (`tipo:id`) para juntar o lote de processos sem N+1. */
export function indexFacts(entries: ActFactEntry[]): Map<string, ActFact> {
  return new Map(entries.map((entry) => [`${entry.originType}:${entry.originId}`, entry.fact]));
}

export function factOf(index: Map<string, ActFact>, process: Process): ActFact | undefined {
  return index.get(`${process.originType}:${process.originId}`);
}
