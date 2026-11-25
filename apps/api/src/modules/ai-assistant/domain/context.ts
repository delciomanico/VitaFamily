// Contexto minimizado e pseudonimizado enviado ao dispositivo (BR-AI-10, openapi `AiContext`). Puro: recebe factos neutros do Resumo de saúde
// (montados em `main/api.ts` sobre `reports`) e devolve só o permitido — sem nomes de medicamentos (etiquetas «Medicamento A/B»), sem datas
// absolutas (deslocamentos em dias desde o início do período), sem notas nem texto livre.
import type { AgeBand } from "./age-band.js";

export interface SummaryFacts {
  /** Por medicamento; o nome NUNCA sai (só serve para ordenar de forma estável). */
  medications: { taken: number; notTaken: number; unconfirmed: number; adherencePct: number | null }[];
  series: { parameter: string; unit: string; referenceMin: number | null; referenceMax: number | null; points: { date: string; value: number }[] }[];
  counts: Record<string, number>;
}

export interface AiContext {
  ageBand: AgeBand;
  sex?: "F" | "M" | "OTHER";
  conditions?: string[];
  adherence?: { label: string; taken: number; notTaken: number; unconfirmed: number; adherencePct: number | null }[];
  series?: { parameter: string; unit: string; referenceMin: number | null; referenceMax: number | null; points: { dayOffset: number; value: number }[] }[];
  counts?: Record<string, number>;
}

const MAX_SERIES = 20;
const MAX_POINTS = 100;
const MAX_CONDITIONS = 20;
const MAX_TEXT = 80;
const DAY_MS = 86_400_000;

/** «Medicamento A», «B», … «Z», «AA»… */
export function medicationLabel(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Medicamento ${out}`;
}

function dayOffset(from: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const clip = (text: string): string => text.trim().slice(0, MAX_TEXT);

export function buildSummaryContext(ageBand: AgeBand, facts: SummaryFacts, periodFrom: string): AiContext {
  return {
    ageBand,
    adherence: facts.medications.map((m, index) => ({ label: medicationLabel(index), taken: m.taken, notTaken: m.notTaken, unconfirmed: m.unconfirmed, adherencePct: m.adherencePct })),
    series: facts.series.slice(0, MAX_SERIES).map((s) => ({
      parameter: clip(s.parameter),
      unit: clip(s.unit),
      referenceMin: s.referenceMin,
      referenceMax: s.referenceMax,
      points: s.points.slice(0, MAX_POINTS).map((p) => ({ dayOffset: dayOffset(periodFrom, p.date), value: p.value })),
    })),
    counts: { ...facts.counts },
  };
}

/** Sintomas: só faixa etária; com `includeContext` (adulto) acrescentam-se as condições ativas (nomes, até 20). O sexo só existiria se declarado. */
export function buildSymptomsContext(ageBand: AgeBand, options: { includeContext: boolean; conditions: string[] }): AiContext {
  if (!options.includeContext) return { ageBand };
  return { ageBand, conditions: options.conditions.map(clip).filter((c) => c.length > 0).slice(0, MAX_CONDITIONS) };
}
