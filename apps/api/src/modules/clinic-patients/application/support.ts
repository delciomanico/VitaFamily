// Auxiliares comuns: vista do paciente (com `vitaLink` sem ids Vita, BR-CLN-17), carregamento isolado por
// clínica e rate limit de pesquisa (BR-CLN-22).
import { NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import type { ClinicPatient, ClinicLinkVia } from "../domain/clinic-patient.js";
import { effectiveConsent } from "../domain/consent.js";
import { SEARCH_ACCOUNT_RULE } from "../domain/rate-limiter.js";
import { doctorPatientIds, isDoctor } from "./doctor-scope.js";
import type { ClinicPatientsDeps, ClinicPortalActor } from "./ports.js";

export interface ClinicPatientView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  origin: "MANUAL" | "VITA";
  vitaLink: { via: ClinicLinkVia; consentLevel: "BOOKINGS" | "HISTORY" | null; consentValidUntil: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

/** Vistas de vários pacientes da MESMA clínica: ligações e consentimentos em lote (sem N+1). */
export async function toPatientViews<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, clinicId: string, patients: ClinicPatient[]): Promise<ClinicPatientView[]> {
  if (patients.length === 0) return [];
  const links = await deps.linksRepo.findByPatients(trx, clinicId, patients.map((p) => p.id));
  const consents = links.length === 0 ? [] : await deps.consentsRepo.findMany(trx, clinicId, links.map((l) => l.memberId));
  const now = deps.clock.now();
  const linkByPatient = new Map(links.map((link) => [link.clinicPatientId, link]));
  const consentByMember = new Map(consents.map((consent) => [consent.memberId, consent]));
  return patients.map((patient) => {
    const link = linkByPatient.get(patient.id);
    const consent = link ? consentByMember.get(link.memberId) : undefined;
    const effective = consent ? effectiveConsent(consent, now) : undefined;
    return {
      id: patient.id,
      name: patient.name,
      phone: patient.phone ?? null,
      email: patient.email ?? null,
      birthDate: patient.birthDate ?? null,
      notes: patient.notes ?? null,
      origin: patient.origin,
      vitaLink: link ? { via: link.via, consentLevel: effective?.level ?? null, consentValidUntil: effective?.validUntil?.toISOString() ?? null } : null,
      createdAt: patient.createdAt.toISOString(),
      updatedAt: patient.updatedAt.toISOString(),
    };
  });
}

export async function toPatientView<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, clinicId: string, patient: ClinicPatient): Promise<ClinicPatientView> {
  const [view] = await toPatientViews(deps, trx, clinicId, [patient]);
  if (!view) throw new Error("vista do paciente em falta");
  return view;
}

/** Paciente da clínica do ator; outra clínica/inexistente => 404 indistinto (authorization.md §6.1). */
export async function requireOwnPatient<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, patientId: string): Promise<ClinicPatient> {
  const patient = await deps.patientsRepo.findById(trx, actor.clinicId, patientId);
  if (!patient) {
    throw new NotFoundError({ detail: "Paciente não encontrado." });
  }
  // BR-CLN-39: o Médico só acede a pacientes com (ou que tiveram) marcação com o seu profissional; fora disso 404.
  if (isDoctor(actor) && !(await doctorPatientIds(deps, trx, actor)).includes(patient.id)) {
    throw new NotFoundError({ detail: "Paciente não encontrado." });
  }
  return patient;
}

/** BR-CLN-22: 60 pedidos/min por conta nas rotas de pesquisa/listagem; não se audita (volume). */
export function enforceSearchRateLimit<Trx>(deps: ClinicPatientsDeps<Trx>, actor: ClinicPortalActor): void {
  const decision = deps.searchLimiter.consume(`clinic-search:${actor.clinicAccountId}`, SEARCH_ACCOUNT_RULE);
  if (!decision.allowed) {
    throw new RateLimitedError(decision.retryAfterMs);
  }
}
