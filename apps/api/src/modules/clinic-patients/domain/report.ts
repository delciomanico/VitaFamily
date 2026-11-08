// Indicadores da clínica (M14 Q, BR-CLN-29): contagens e taxas por profissional a partir de factos já filtrados pela
// clínica. Puro e sem I/O; nunca recebe nomes nem ids de pacientes (só estado, horário e flag "Não posso").
import { ValidationError } from "../../../platform/errors/index.js";
import { addDaysIso, diffDaysIso, isIsoDate, localMidnightUtc } from "../../../platform/time/index.js";

export const REPORT_MAX_DAYS = 366;

export interface ReportWindow {
  from: string;
  to: string;
  /** `[start, end)` em UTC: dias locais `[from, to]` inclusivos em `CLINIC_TIMEZONE`. */
  start: Date;
  end: Date;
}

/** `from`/`to` = dias locais AAAA-MM-DD; `to ≥ from` e no máximo 366 dias. */
export function parseReportWindow(fromRaw: unknown, toRaw: unknown): ReportWindow {
  if (!isIsoDate(fromRaw) || !isIsoDate(toRaw)) {
    throw new ValidationError([{ field: "from", message: "from/to têm de ser datas AAAA-MM-DD" }], { detail: "Janela inválida." });
  }
  if (toRaw < fromRaw) {
    throw new ValidationError([{ field: "to", message: "não pode ser anterior a from" }], { detail: "Janela inválida." });
  }
  if (diffDaysIso(fromRaw, toRaw) + 1 > REPORT_MAX_DAYS) {
    throw new ValidationError([{ field: "to", message: `janela máxima de ${String(REPORT_MAX_DAYS)} dias` }], { detail: "Janela demasiado grande." });
  }
  return { from: fromRaw, to: toRaw, start: localMidnightUtc(fromRaw), end: localMidnightUtc(addDaysIso(toRaw, 1)) };
}

export interface ReportSlot {
  id: string;
  capacity: number;
  professionalId: string | null;
}

/** Marcação reduzida ao necessário: nada que identifique o paciente. */
export interface ReportFact {
  kind: "APPOINTMENT" | "VISIT" | "EXAM";
  status: string;
  slotId: string | null;
  /** `confirmationStatus = DECLINED` ("Não posso"). */
  declined: boolean;
  /** Profissional do horário (consultas/visitas/exames sem horário => `null`). */
  professionalId: string | null;
}

export interface ReportCounts {
  slotsTotal: number;
  slotsBooked: number;
  occupancyRate: number | null;
  completed: number;
  noShows: number;
  noShowRate: number | null;
  cancellations: number;
  declinedByPatient: number;
}

export interface ReportRow extends ReportCounts {
  professionalId: string | null;
}

export interface ReportResult {
  totals: ReportCounts & { examsCompleted: number };
  rows: ReportRow[];
}

const ACTIVE_OR_DONE = new Set(["REQUESTED", "SCHEDULED", "COMPLETED", "NO_SHOW"]);
const EXAM_ACTIVE_OR_DONE = new Set(["SCHEDULED", "COMPLETED"]);

type Raw = Omit<ReportCounts, "occupancyRate" | "noShowRate">;

function emptyRaw(): Raw {
  return { slotsTotal: 0, slotsBooked: 0, completed: 0, noShows: 0, cancellations: 0, declinedByPatient: 0 };
}

function withRates(raw: Raw): ReportCounts {
  const finished = raw.completed + raw.noShows;
  return {
    ...raw,
    occupancyRate: raw.slotsTotal > 0 ? raw.slotsBooked / raw.slotsTotal : null,
    noShowRate: finished > 0 ? raw.noShows / finished : null,
  };
}

/**
 * Regras de BR-CLN-29. `professionalFilter`: `undefined` = clínica toda; um id = só essa linha (totais incluídos).
 * `slotsBooked` = Σ min(capacity, marcações ativas/realizadas no horário); marcações sem horário contam em
 * completed/noShows/cancellations mas não em slotsBooked.
 */
export function buildReport(slots: ReportSlot[], facts: ReportFact[], professionalFilter?: string): ReportResult {
  const rows = new Map<string | null, Raw>();
  const rowOf = (professionalId: string | null): Raw => {
    let row = rows.get(professionalId);
    if (!row) {
      row = emptyRaw();
      rows.set(professionalId, row);
    }
    return row;
  };
  const keep = (professionalId: string | null): boolean => professionalFilter === undefined || professionalId === professionalFilter;

  if (professionalFilter === undefined) {
    rowOf(null);
  } else {
    rowOf(professionalFilter);
  }

  const bookedBySlot = new Map<string, number>();
  let examsCompleted = 0;
  for (const fact of facts) {
    if (!keep(fact.professionalId)) continue;
    const row = rowOf(fact.professionalId);
    if (fact.kind === "EXAM") {
      if (fact.status === "COMPLETED") examsCompleted += 1;
      if (fact.slotId && EXAM_ACTIVE_OR_DONE.has(fact.status)) bookedBySlot.set(fact.slotId, (bookedBySlot.get(fact.slotId) ?? 0) + 1);
      continue;
    }
    if (fact.slotId && ACTIVE_OR_DONE.has(fact.status)) bookedBySlot.set(fact.slotId, (bookedBySlot.get(fact.slotId) ?? 0) + 1);
    if (fact.status === "COMPLETED") row.completed += 1;
    else if (fact.status === "NO_SHOW") row.noShows += 1;
    else if (fact.status === "CANCELLED") {
      row.cancellations += 1;
      if (fact.declined) row.declinedByPatient += 1;
    }
  }
  for (const slot of slots) {
    if (!keep(slot.professionalId)) continue;
    const row = rowOf(slot.professionalId);
    row.slotsTotal += slot.capacity;
    row.slotsBooked += Math.min(slot.capacity, bookedBySlot.get(slot.id) ?? 0);
  }

  const total = emptyRaw();
  const list: ReportRow[] = [];
  for (const [professionalId, raw] of rows) {
    for (const key of Object.keys(total) as (keyof Raw)[]) total[key] += raw[key];
    list.push({ professionalId, ...withRates(raw) });
  }
  return { totals: { ...withRates(total), examsCompleted }, rows: list };
}
