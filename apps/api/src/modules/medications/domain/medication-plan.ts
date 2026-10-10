// Entidade pura `MedicationPlan` (entities.md, categoria C4) e validação do desenho do plano
// (BR-MED-01/02, schema.md §3 CHECKs — replicados aqui para devolver `INVALID_SCHEDULE` com
// mensagem útil antes de chegar à BD, não só a constraint). Sem I/O.
import { DomainError } from "../../../platform/errors/index.js";
import { isValidTimeOfDay } from "./schedule.js";

export type ScheduleType = "FIXED_TIMES" | "INTERVAL";
export type PlanStatus = "ACTIVE" | "ENDED";

export interface MedicationPlan {
  id: string;
  familyId: string;
  memberId: string;
  prescriptionId?: string;
  name: string;
  dosage: string;
  scheduleType: ScheduleType;
  times?: string[];
  daysOfWeek?: number[];
  intervalHours?: number;
  startAt: Date;
  endAt?: Date;
  continuous: boolean;
  notes?: string;
  status: PlanStatus;
  endedAt?: Date;
  createdAt: Date;
}

function invalidSchedule(message: string): never {
  throw new DomainError("INVALID_SCHEDULE", { detail: message });
}

export interface ScheduleCandidate {
  scheduleType: ScheduleType;
  times?: string[] | null | undefined;
  daysOfWeek?: number[] | null | undefined;
  intervalHours?: number | null | undefined;
  startAt: Date;
  endAt?: Date | null | undefined;
  continuous?: boolean | null | undefined;
}

export interface ValidatedSchedule {
  times?: string[];
  daysOfWeek?: number[];
  intervalHours?: number;
  endAt?: Date;
  continuous: boolean;
}

/** BR-MED-01/02: horários fixos (dias da semana opcionais) OU "de X em X horas"; início+(fim OU
 * contínuo), nunca os dois nem nenhum; fim sempre posterior ao início (schema.md §3 CHECKs). */
export function assertValidSchedule(input: ScheduleCandidate): ValidatedSchedule {
  const continuous = input.continuous ?? false;
  const hasEndAt = input.endAt !== null && input.endAt !== undefined;
  if (continuous === hasEndAt) {
    invalidSchedule("Indique a data de fim OU uso contínuo (nunca os dois, nem nenhum).");
  }
  if (input.endAt && input.endAt.getTime() <= input.startAt.getTime()) {
    invalidSchedule("A data de fim tem de ser posterior ao início.");
  }

  if (input.scheduleType === "FIXED_TIMES") {
    return { ...validateFixedTimes(input), continuous, ...(input.endAt ? { endAt: input.endAt } : {}) };
  }
  return { ...validateInterval(input), continuous, ...(input.endAt ? { endAt: input.endAt } : {}) };
}

function validateFixedTimes(input: ScheduleCandidate): Pick<ValidatedSchedule, "times" | "daysOfWeek"> {
  const times = input.times ?? [];
  if (times.length === 0) {
    invalidSchedule("Indique pelo menos um horário.");
  }
  for (const time of times) {
    if (!isValidTimeOfDay(time)) {
      invalidSchedule(`Horário inválido: "${time}" (esperado HH:mm).`);
    }
  }
  if (input.intervalHours !== null && input.intervalHours !== undefined) {
    invalidSchedule("Não indique intervalo de horas num plano de horários fixos.");
  }
  const daysOfWeek = input.daysOfWeek ?? [];
  for (const day of daysOfWeek) {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      invalidSchedule("Os dias da semana devem estar entre 1 (segunda) e 7 (domingo).");
    }
  }
  return { times, daysOfWeek };
}

function validateInterval(input: ScheduleCandidate): Pick<ValidatedSchedule, "intervalHours"> {
  if (input.times !== null && input.times !== undefined && input.times.length > 0) {
    invalidSchedule("Não indique horários num plano de intervalo.");
  }
  if (input.daysOfWeek !== null && input.daysOfWeek !== undefined && input.daysOfWeek.length > 0) {
    invalidSchedule("Não indique dias da semana num plano de intervalo.");
  }
  const intervalHours = input.intervalHours;
  if (intervalHours === null || intervalHours === undefined || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) {
    invalidSchedule("O intervalo tem de ser um número inteiro de horas entre 1 e 168.");
  }
  return { intervalHours };
}

const ALLOWED_PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  ACTIVE: ["ENDED"],
  ENDED: ["ACTIVE"],
};

/** ST1: ACTIVE<->ENDED (reabrir não recria tomas passadas — só gera tomas futuras, UC-MED-04/entities.md). */
export function assertValidPlanTransition(from: PlanStatus, to: PlanStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_PLAN_TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado do plano não permitida." });
  }
}
