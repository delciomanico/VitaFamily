// Receita digital do PROFISSIONAL (MK4, UC-MKT-59/60; BR-MKT-79..81, OP-126/127). Só existe com `DIGITAL_PRESCRIPTION_ENABLED` (lida no arranque
// e injetada; desligada ⇒ `NOT_FOUND`, indistinguível de rota inexistente — as rotas nem se montam). A marcação procura-se SEMPRE por
// (`professionalId` do token, id): de outro profissional ou inexistente ⇒ `NOT_FOUND` idêntico, antes de qualquer outro erro.
// A emissão corre numa transação SOB BLOQUEIO da marcação: profissional `APPROVED` (lido AGORA, antes de abrir a transação, por outra ligação
// do pool), categoria `HEALTH`, `COMPLETED` (qualquer método) até 7 dias depois de `completedAt`, sem receita na marcação; depois a porta
// `PrescriptionIssuer` cria a receita e os planos na MESMA transação, e levanta o alerta genérico `BOOKING_UPDATED` à família (BR-MKT-65).
// Privacidade (BR-MKT-81): medicamentos, dosagens e observações nunca em logs, erros, auditoria nem alertas; o profissional não recebe ids de
// família, membro nem da receita.
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { PRESCRIPTION_WINDOW_MS } from "../domain/prescribe.js";
import { validateOptionalFreeText } from "../domain/text.js";
import type { ConsultationsDeps, PrescriptionMedicationInput, ProfessionalActor, RequestContext } from "./ports.js";
import { enforcePrescriptionRate } from "./rate-limit.js";

export const PRESCRIPTION_NOTES_MAX = 500;
export const PRESCRIPTION_MAX_MEDICATIONS = 10;

export interface ProfessionalPrescriptionView {
  bookingId: string;
  issuedOn: string;
  notes: string | null;
  medications: PrescriptionMedicationInput[];
  createdAt: string;
}

export interface IssueProfessionalPrescriptionInput {
  notes?: string | null;
  medications: PrescriptionMedicationInput[];
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Luanda", year: "numeric", month: "2-digit", day: "2-digit" });
/**
 * «Hoje em Africa/Luanda» (BR-MKT-80), nunca depois do dia UTC: a BD valida `issued_on <= current_date` na sessão em UTC, e entre as 23:00 e as
 * 24:00 UTC já é o dia seguinte em Luanda (a emissão rebentaria). Nessa hora usa-se o dia UTC (OP-129, omissão segura).
 */
function issuedOnFor(at: Date): string {
  const luanda = dayFormat.format(at);
  const utc = at.toISOString().slice(0, 10);
  return luanda < utc ? luanda : utc;
}
const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });
const notFound = (): NotFoundError => new NotFoundError({ detail: "Marcação não encontrada." });

export function createProfessionalPrescriptions<Trx>(deps: ConsultationsDeps<Trx>) {
  const now = (): Date => deps.clock.now();

  /** Defesa em profundidade: com a flag desligada as rotas nem se montam, mas o caso de uso também recusa (404). */
  function assertEnabled(): void {
    if (!deps.digitalPrescriptionEnabled) throw new NotFoundError();
  }

  function validate(input: IssueProfessionalPrescriptionInput): { notes: string | null; medications: PrescriptionMedicationInput[] } {
    const notes = validateOptionalFreeText(input.notes, PRESCRIPTION_NOTES_MAX);
    if (!notes.ok) throw invalid("notes", notes.error === "TOO_LONG" ? "excede o tamanho máximo" : "contém caracteres inválidos");
    if (!Array.isArray(input.medications) || input.medications.length < 1 || input.medications.length > PRESCRIPTION_MAX_MEDICATIONS) {
      throw invalid("medications", "indique entre 1 e 10 medicamentos");
    }
    input.medications.forEach((m, index) => {
      if (typeof m.name !== "string" || m.name.trim().length === 0) throw invalid(`medications[${String(index)}].name`, "obrigatório");
      if (typeof m.dosage !== "string" || m.dosage.trim().length === 0) throw invalid(`medications[${String(index)}].dosage`, "obrigatório");
    });
    return { notes: notes.text, medications: input.medications.map((m) => ({ ...m, name: m.name.trim(), dosage: m.dosage.trim() })) };
  }

  return {
    /** UC-MKT-59. */
    async issue(actor: ProfessionalActor, bookingId: string, input: IssueProfessionalPrescriptionInput, context: RequestContext): Promise<ProfessionalPrescriptionView> {
      assertEnabled();
      await enforcePrescriptionRate(deps.prescriptionRateLimiter, "prescription-issue", actor.professionalAccountId);
      const content = validate(input);
      // Identidade lida ANTES de abrir a transação (outra ligação do pool; com a ligação presa ao `FOR UPDATE`, emissões concorrentes esgotariam o pool).
      const identity = (await deps.agenda.findIdentities([actor.professionalId]))[0];
      return deps.withTransaction(async (trx) => {
        const booking = await deps.bookings.findForProfessional(trx, actor.professionalId, bookingId, true);
        if (!booking) throw notFound();
        if (!identity?.approved) throw new DomainError("PROFESSIONAL_LOCKED", { detail: "O seu perfil não está aprovado: só pode consultar as marcações." });
        const specialty = (await deps.agenda.findSpecialties([booking.specialtyId]))[0];
        if (specialty?.category !== "HEALTH") throw new ForbiddenError({ detail: "Esta especialidade não emite receitas." });
        const at = now();
        if (booking.status !== "COMPLETED" || booking.completedAt === null || at.getTime() > booking.completedAt.getTime() + PRESCRIPTION_WINDOW_MS) {
          throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A receita só pode ser emitida até 7 dias depois de a consulta ser concluída." });
        }
        if ((await deps.prescriptions.findPrescriptionIds(trx, [booking.id])).has(booking.id)) throw new DomainError("CONFLICT", { detail: "Esta marcação já tem uma receita." });
        await deps.prescriptions.issue(
          trx,
          {
            familyId: booking.familyId,
            memberId: booking.memberId,
            bookingId: booking.id,
            professionalId: actor.professionalId,
            professionalAccountId: actor.professionalAccountId,
            professionalName: identity.displayName,
            issuedOn: issuedOnFor(at),
            notes: content.notes,
            medications: content.medications,
          },
          context,
        );
        await deps.alerts.raise(trx, { kind: "BOOKING_UPDATED", bookingId: booking.id, familyId: booking.familyId, memberId: booking.memberId, stateVersion: at.toISOString() });
        const issued = await deps.prescriptions.findIssued(trx, booking.id, actor.professionalId);
        if (!issued) throw new Error("receita emitida não encontrada na mesma transação");
        return toView(booking.id, issued);
      });
    },

    /** UC-MKT-60: só o que o próprio escreveu; não auditado; em todos os estados de validação. */
    async get(actor: ProfessionalActor, bookingId: string): Promise<ProfessionalPrescriptionView> {
      assertEnabled();
      await enforcePrescriptionRate(deps.prescriptionRateLimiter, "prescription-read", actor.professionalAccountId);
      return deps.withTransaction(async (trx) => {
        const booking = await deps.bookings.findForProfessional(trx, actor.professionalId, bookingId, false);
        if (!booking) throw notFound();
        const issued = await deps.prescriptions.findIssued(trx, booking.id, actor.professionalId);
        if (!issued) throw new NotFoundError({ detail: "Receita não encontrada." });
        return toView(booking.id, issued);
      });
    },
  };
}

function toView(bookingId: string, issued: { issuedOn: string; notes: string | null; medications: PrescriptionMedicationInput[]; createdAt: Date }): ProfessionalPrescriptionView {
  return { bookingId, issuedOn: issued.issuedOn, notes: issued.notes, medications: issued.medications, createdAt: issued.createdAt.toISOString() };
}

export type ProfessionalPrescriptions = ReturnType<typeof createProfessionalPrescriptions<unknown>>;
