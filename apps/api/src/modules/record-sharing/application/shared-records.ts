// `SharedRecordsReader` (MK4, BR-MKT-68, modules.md nota 38(b)): conteúdo partilhado lido **no momento** de cada abertura, só das categorias
// concedidas (as outras secções são **omitidas**, nunca `null`). Uma só porta, composta em `main/api.ts` sobre as leituras públicas dos
// módulos de saúde (campos mínimos: cada módulo dono filtra os seus campos); sem `AccessPolicy` (a autorização é a partilha). Sem I/O próprio:
// só orquestra funções injetadas. Não guarda nada. `ageYears` deriva-se da data de nascimento na leitura e a data de nascimento não sai daqui.
import { computeAgeYears, luandaDayMonthsAgo, type DataCategory } from "../domain/index.js";

export const SHARED_WINDOW_MONTHS = 24;

export interface SharedAllergy { name: string; since?: string }
export interface SharedCondition { name: string; kind: "CONDITION" | "HISTORY"; since?: string; until?: string }
export interface SharedMedication { name: string; dosage: string; startAt: string; endAt: string | null; continuous: boolean }
export interface SharedAppointment { scheduledAt: string; status: string; specialty?: string | null; professionalName?: string | null }
export interface SharedExamResult { parameter: string; valueNumeric?: number | null; valueText?: string | null; unit?: string | null; referenceMin?: number | null; referenceMax?: number | null }
export interface SharedExam { name: string; examDate: string; status: "SCHEDULED" | "COMPLETED"; results: SharedExamResult[] }

/** Secções existem só para as categorias concedidas; `ageYears` está **sempre** presente (OP-119). */
export interface SharedRecordsContent {
  ageYears: number;
  allergies?: SharedAllergy[];
  bloodType?: string;
  conditions?: SharedCondition[];
  medications?: SharedMedication[];
  appointments?: SharedAppointment[];
  examinations?: SharedExam[];
}

export interface SharedRecordsReader<Trx> {
  read(trx: Trx, input: { familyId: string; memberId: string; categories: readonly DataCategory[]; now: Date }): Promise<SharedRecordsContent>;
}

/** Leituras públicas dos módulos de saúde (todas só leitura, na transação da abertura; ligadas em `main/api.ts`). */
export interface SharedRecordsSources<Trx> {
  /** Data de nascimento `AAAA-MM-DD` do membro (só para derivar a idade; nunca devolvida). */
  birthDate(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
  bloodType(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
  allergies(trx: Trx, familyId: string, memberId: string): Promise<{ name: string; since: string | null }[]>;
  conditions(trx: Trx, familyId: string, memberId: string): Promise<{ name: string; kind: "CONDITION" | "HISTORY"; since: string | null; until: string | null }[]>;
  activeMedications(trx: Trx, familyId: string, memberId: string): Promise<{ name: string; dosage: string; startAt: Date; endAt: Date | null; continuous: boolean }[]>;
  appointments(trx: Trx, familyId: string, memberId: string, since: Date): Promise<{ scheduledAt: Date; status: string; specialty: string | null; professionalName: string | null }[]>;
  /** `since` = `AAAA-MM-DD`; exames `SCHEDULED|COMPLETED` desde essa data e futuros. */
  examinations(trx: Trx, familyId: string, memberId: string, since: string): Promise<SharedExam[]>;
}

export function createSharedRecordsReader<Trx>(sources: SharedRecordsSources<Trx>): SharedRecordsReader<Trx> {
  return {
    async read(trx, { familyId, memberId, categories, now }) {
      const nowMs = now.getTime();
      const birthDate = await sources.birthDate(trx, familyId, memberId);
      const ageYears = birthDate === null ? null : computeAgeYears(birthDate, nowMs);
      // Sem data de nascimento válida não há leitura segura da identificação: falha (a abertura reverte, nada se consome).
      if (ageYears === null) throw new Error("data de nascimento do membro indisponível");
      const since = luandaDayMonthsAgo(nowMs, SHARED_WINDOW_MONTHS);
      const content: SharedRecordsContent = { ageYears };
      const granted = new Set(categories);
      if (granted.has("ALLERGIES")) {
        content.allergies = (await sources.allergies(trx, familyId, memberId)).map((a) => ({ name: a.name, ...(a.since ? { since: a.since } : {}) }));
        const blood = await sources.bloodType(trx, familyId, memberId);
        if (blood !== null) content.bloodType = blood;
      }
      if (granted.has("CONDITIONS")) {
        content.conditions = (await sources.conditions(trx, familyId, memberId)).map((c) => ({
          name: c.name,
          kind: c.kind,
          ...(c.since ? { since: c.since } : {}),
          ...(c.until ? { until: c.until } : {}),
        }));
      }
      if (granted.has("MEDICATION")) {
        content.medications = (await sources.activeMedications(trx, familyId, memberId)).map((m) => ({
          name: m.name,
          dosage: m.dosage,
          startAt: m.startAt.toISOString(),
          endAt: m.endAt === null ? null : m.endAt.toISOString(),
          continuous: m.continuous,
        }));
      }
      if (granted.has("APPOINTMENTS")) {
        content.appointments = (await sources.appointments(trx, familyId, memberId, new Date(`${since}T00:00:00+01:00`))).map((a) => ({
          scheduledAt: a.scheduledAt.toISOString(),
          status: a.status,
          specialty: a.specialty,
          professionalName: a.professionalName,
        }));
      }
      if (granted.has("EXAMS")) {
        content.examinations = await sources.examinations(trx, familyId, memberId, since);
      }
      return content;
    },
  };
}
