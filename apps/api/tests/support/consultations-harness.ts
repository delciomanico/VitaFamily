// Harness de integração do lado da FAMÍLIA de `consultations` (MK3 S6): PostgreSQL real (testcontainers, todas as migrações) e o módulo
// real ligado como em `main/api.ts` — `access`/`families`/`users` reais, `ProcessLinker` real (`processes`), consulta gerada real
// (`appointments`), conversas reais (`messaging.lookup`) e o `SelfDealingGuard` real sobre a raiz `ProfessionalDirectory`. Assenta em
// `startProfessionalsHarness` (app real com validação de pedidos E respostas contra o openapi.yaml). Os dados entram por SQL (o lado
// profissional e o de administração são outras fatias); os tokens de User são de vida longa para sobreviver a avanços do relógio.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { createAccessModule } from "../../src/modules/access/index.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { createFamilyAppointmentWriter, type FamilyAppointmentWriterImpl } from "../../src/modules/appointments/application/family-appointment-writer.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createConsultationsJobs, createConsultationsModule, createSelfDealingGuard } from "../../src/modules/consultations/index.js";
import { createDiscoveryModule } from "../../src/modules/discovery/index.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
import { signProfessionalAccessToken } from "../../src/modules/professionals/domain/jwt.js";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import type { FixedClock } from "../../src/platform/clock/index.js";
import type { InMemoryStorage } from "../../src/platform/storage/index.js";
import { withTransaction, type Database } from "../../src/platform/db/index.js";
import { INFECTED_MARKER, SIGNING_KEYS, START, startProfessionalsHarness, type LogSink, type ProfessionalsHarness } from "./professionals-harness.js";
import { createRealProcessLinker } from "./process-linker.js";

export { START };

/** Token de User de vida longa (120 dias): os testes avançam o relógio até 60 dias sem o expirar. */
const TOKEN_TTL_SECONDS = 120 * 86_400;

export interface UserFixture {
  id: string;
  email: string;
  token: string;
}

export interface MemberOptions {
  userId?: string;
  dependent?: boolean;
  role?: "FAMILY_ADMIN" | "FAMILY_MEMBER";
  blocked?: boolean;
  guardians?: string[];
  name?: string;
}

export interface ProfessionalFixture {
  professionalId: string;
  email: string;
  token: string;
  specialtyId: string;
  specialtyName: string;
}

export interface OfferFixture {
  id: string;
  ruleId: string;
  professionalId: string;
  specialtyId: string;
  method: string;
  durationMinutes: number;
  priceKz: number;
}

export interface ConsultationsHarness {
  h: ProfessionalsHarness;
  appointments: FamilyAppointmentWriterImpl<Kysely<Database>>;
  /** Utilizador `ACTIVE` com token (JWT) de vida longa. */
  user(name: string, options?: { email?: string; birth?: string }): Promise<UserFixture>;
  family(name?: string): Promise<string>;
  member(familyId: string, options?: MemberOptions): Promise<string>;
  /** Concessão de partilha por categoria: `owner` partilha com `grantee` (mesma família). */
  sharing(familyId: string, owner: string, grantee: string, category?: string): Promise<void>;
  /** Profissional com conta verificada, perfil preenchido, especialidade e token; `status` por omissão `APPROVED`. */
  professional(options?: { status?: "APPROVED" | "SUSPENDED" | "DRAFT"; email?: string; paymentInstructions?: string | null; name?: string }): Promise<ProfessionalFixture>;
  /** Oferta (ativa por omissão) com regra de horário que cobre todos os dias. */
  offer(pro: ProfessionalFixture, options: { method: string; durationMinutes: number; priceKz: number; active?: boolean }): Promise<OfferFixture>;
  /** Horário (`professional_slots`) livre da oferta. */
  slot(offer: OfferFixture, startsAt: Date, minutes?: number): Promise<string>;
  /** Marcação `REQUESTED`/`CONFIRMED` gerada por SQL (horário ocupado, sem `Process`), para montar limites e listagens sem a API. */
  seedBooking(input: { familyId: string; memberId: string; offer: OfferFixture; startsAt: Date; status?: "REQUESTED" | "CONFIRMED"; createdByUserId?: string | null; label?: string }): Promise<{ bookingId: string; slotId: string }>;
  /** Token de ProfessionalAccount de vida longa (120 dias), para avançar o relógio sem o expirar (o `token` de `professional()` expira em 900 s). */
  professionalToken(professionalId: string): Promise<string>;
  /** Corre os jobs de antivírus pendentes (o ficheiro com `INFECTED_MARKER` sai infetado). */
  runProofScans(): Promise<void>;
  /** Corre a outbox `consultations.delete-files`. */
  runDeleteFiles(): Promise<{ deleted: number; failed: number }>;
  /** Fila de antivírus (só para os testes inspecionarem). */
  proofQueue: { proofId: string }[];
  stop(): Promise<void>;
}

/** Arranca PostgreSQL + app real com o módulo `consultations` ligado (rota da família e descoberta pública). */
export async function startConsultationsHarness(options: { logStream?: LogSink } = {}): Promise<ConsultationsHarness> {
  let appointments: FamilyAppointmentWriterImpl<Kysely<Database>> | undefined;
  let jobsDeps: { db: Kysely<Database>; clock: FixedClock; storage: InMemoryStorage } | undefined;
  const proofQueue = { jobs: [] as { proofId: string }[], enqueueScan(job: { proofId: string }): Promise<void> { this.jobs.push(job); return Promise.resolve(); } };

  const h = await startProfessionalsHarness(
    {},
    ({ audit, db, clock, module, storage }) => {
      const users = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
      const families = createFamiliesModule({
        db,
        audit,
        users,
        clock,
        mailer: { send: () => Promise.resolve() },
        appBaseUrl: "https://vitafamily.cassfrei.com",
        memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) },
      });
      const access = createAccessModule({ db, audit, families, clock });
      const discovery = createDiscoveryModule({ clock, catalog: { listApprovedFacts: (q) => module.directory.listApprovedFacts(q), getApprovedFacts: (ids) => module.directory.getApprovedFacts(ids) } });
      const messaging = createMessagingModule({
        db,
        audit,
        clock,
        access: {
          assertCanMessage: async (trx, input) => {
            const ctx = await access.policy.can(trx, { userId: input.userId, platformAdmin: input.platformAdmin, familyId: input.familyId, action: "MESSAGE_PROFESSIONALS", subjectMemberId: input.memberId });
            return { relation: ctx.relation === "TUTOR_OF" ? "TUTOR_OF" : "SELF" };
          },
        },
        professionals: { findIdentities: (ids) => module.directory.getConversationIdentities(ids), getNotificationEmail: () => Promise.resolve(null) },
        alerts: { raiseMessageReceived: () => Promise.resolve(), markConversationRead: () => Promise.resolve() },
        noticeQueue: { enqueue: () => Promise.resolve() },
      });
      const writer = createFamilyAppointmentWriter({ appointmentsRepo: new KyselyAppointmentsRepository(), clock });
      const processes = createRealProcessLinker(db);
      appointments = writer;
      jobsDeps = { db, clock, storage };

      const consultations = createConsultationsModule({
        db,
        audit,
        clock,
        access: {
          // Mesma ligação que `main/api.ts`: só SELF/TUTOR_OF; DEPENDENT_SELF, OTHER e Family Admin como OTHER ⇒ 403; outra família ⇒ 404.
          assertCanBook: async (trx, input) => {
            const ctx = await access.policy.can(trx, { userId: input.userId, platformAdmin: input.platformAdmin, familyId: input.familyId, action: "BOOK_PROFESSIONALS", subjectMemberId: input.memberId });
            return { relation: ctx.relation === "TUTOR_OF" ? "TUTOR_OF" : "SELF" };
          },
        },
        agenda: {
          getBookingFacts: (offerId, slotId) => module.directory.getBookingFacts(offerId, slotId),
          reserveSlot: (trx, input) => module.directory.reserveSlot(trx, input),
          releaseSlot: (trx, bookingId) => module.directory.releaseSlot(trx, bookingId),
          listApprovedOfferIds: async (professionalId) => (await module.directory.getApprovedProfile(professionalId))?.offers.map((offer) => offer.id) ?? null,
          listBookableSlots: (professionalId, from, to) => module.directory.listBookableSlots(professionalId, from, to),
          readPaymentInstructions: (professionalId) => module.directory.readPaymentInstructions(professionalId),
          findIdentities: (ids) => module.directory.getConversationIdentities(ids),
          findSpecialties: (ids) => module.directory.findSpecialties(ids),
        },
        selfDealing: createSelfDealingGuard({
          professionalEmail: (professionalId) => module.directory.getNotificationEmail(professionalId),
          userEmail: async (userId) => (await withTransaction(db, (trx) => users.byId(trx, userId)))?.email ?? null,
        }),
        processes: { open: (trx, input) => processes.open(trx, input) },
        appointments: writer,
        conversations: messaging.lookup,
        storage,
        scanQueue: proofQueue,
      });
      return [discovery.router, consultations.familyRouter, consultations.professionalRouter];
    },
    options.logStream ? { logStream: options.logStream } : {},
  );

  if (!appointments) throw new Error("consultations não ligado");
  const writer = appointments;
  const { pool, clock } = h;
  if (!jobsDeps) throw new Error("jobs não ligados");
  const jobs = createConsultationsJobs({ ...jobsDeps, scanner: { scan: (buffer) => Promise.resolve(buffer.includes(INFECTED_MARKER) ? "INFECTED" : "CLEAN") } });

  const mintToken = async (userId: string): Promise<string> =>
    (await signAccessToken({ subject: { userId, sessionId: randomUUID() }, now: clock.now(), ttlSeconds: TOKEN_TTL_SECONDS, signingKeys: SIGNING_KEYS })).token;

  const slot = async (offer: OfferFixture, startsAt: Date, minutes = offer.durationMinutes): Promise<string> => {
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    const row = await pool.query<{ id: string }>(
      "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [offer.professionalId, offer.id, offer.ruleId, startsAt.toISOString(), endsAt.toISOString()],
    );
    return row.rows[0]?.id ?? "";
  };

  return {
    h,
    appointments: writer,
    async user(name, options = {}) {
      const id = randomUUID();
      const email = options.email ?? `${name}-${id}@exemplo.ao`;
      await pool.query(
        "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,$4,'Africa/Luanda','ACTIVE','1',now())",
        [id, email, name, options.birth ?? "1985-01-01"],
      );
      return { id, email, token: await mintToken(id) };
    },
    async family(name = "Família") {
      const id = randomUUID();
      await pool.query("INSERT INTO families (id, name) VALUES ($1,$2)", [id, name]);
      return id;
    },
    async member(familyId, options = {}) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status, blocked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          familyId,
          options.userId ?? null,
          options.name ?? "Membro",
          options.dependent ? "2018-01-01" : "1985-01-01",
          options.role ?? null,
          options.dependent ?? false,
          options.blocked ? "BLOCKED" : "ACTIVE",
          options.blocked ? clock.now() : null,
        ],
      );
      for (const [i, guardian] of (options.guardians ?? []).entries()) {
        await pool.query("INSERT INTO guardianships (family_id, dependent_id, guardian_id, is_primary) VALUES ($1,$2,$3,$4)", [familyId, id, guardian, i === 0]);
      }
      return id;
    },
    async sharing(familyId, owner, grantee, category = "APPOINTMENTS") {
      await pool.query("INSERT INTO sharing_grants (family_id, owner_member_id, grantee_member_id, category) VALUES ($1,$2,$3,$4::data_category)", [familyId, owner, grantee, category]);
    },
    async professional(options = {}) {
      const status = options.status ?? "APPROVED";
      const email = options.email ?? `pro-${randomUUID()}@exemplo.ao`;
      const created = await h.newProfessional(email);
      await pool.query(
        "UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = 'Luanda', payment_instructions = $4, approved_at = CASE WHEN $2::text = 'APPROVED' THEN now() END, submitted_at = now() WHERE id = $1",
        [created.professionalId, status, options.name ?? "Dra. Consulta", options.paymentInstructions ?? null],
      );
      const specialtyName = `Especialidade ${randomUUID().slice(0, 8)}`;
      const specialty = await pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1,'HEALTH',true) RETURNING id", [specialtyName]);
      const specialtyId = specialty.rows[0]?.id ?? "";
      await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [created.professionalId, specialtyId]);
      return { professionalId: created.professionalId, email, token: created.token, specialtyId, specialtyName };
    },
    async offer(pro, options) {
      const offer = await pool.query<{ id: string }>(
        "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, active) VALUES ($1,$2,$3::offer_method,$4,$5,$6) RETURNING id",
        [pro.professionalId, pro.specialtyId, options.method, options.durationMinutes, options.priceKz, options.active ?? true],
      );
      const offerId = offer.rows[0]?.id ?? "";
      const rule = await pool.query<{ id: string }>(
        "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'00:00','23:59') RETURNING id",
        [pro.professionalId, offerId, [1, 2, 3, 4, 5, 6, 7]],
      );
      return { id: offerId, ruleId: rule.rows[0]?.id ?? "", professionalId: pro.professionalId, specialtyId: pro.specialtyId, method: options.method, durationMinutes: options.durationMinutes, priceKz: options.priceKz };
    },
    slot,
    async seedBooking(input) {
      const { offer, startsAt } = input;
      const slotId = await slot(offer, startsAt);
      const bookingId = randomUUID();
      const status = input.status ?? "REQUESTED";
      const at = clock.now();
      const endsAt = new Date(startsAt.getTime() + offer.durationMinutes * 60_000);
      await pool.query(
        `INSERT INTO bookings (id, family_id, member_id, professional_id, offer_id, specialty_id, method, duration_minutes, price_kz, starts_at, ends_at, slot_id,
           status, payment_status, participant_label, confirmed_at, created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::offer_method,$8,$9,$10,$11,$12,$13::booking_status,$14::booking_payment_status,$15,$16,$17,$18,$18)`,
        [
          bookingId,
          input.familyId,
          input.memberId,
          offer.professionalId,
          offer.id,
          offer.specialtyId,
          offer.method,
          offer.durationMinutes,
          offer.priceKz,
          startsAt.toISOString(),
          endsAt.toISOString(),
          slotId,
          status,
          offer.priceKz === 0 ? "NOT_REQUIRED" : "AWAITING_PROOF",
          input.label ?? "Semente",
          status === "CONFIRMED" ? at.toISOString() : null,
          input.createdByUserId ?? null,
          at.toISOString(),
        ],
      );
      await pool.query("UPDATE professional_slots SET booking_id = $2 WHERE id = $1", [slotId, bookingId]);
      return { bookingId, slotId };
    },
    async professionalToken(professionalId) {
      const row = await pool.query<{ account_id: string }>("SELECT account_id FROM professionals WHERE id = $1", [professionalId]);
      const professionalAccountId = row.rows[0]?.account_id;
      if (!professionalAccountId) throw new Error("profissional sem conta");
      return (await signProfessionalAccessToken({ subject: { professionalAccountId, professionalId, sessionId: randomUUID() }, now: clock.now(), ttlSeconds: TOKEN_TTL_SECONDS, signingKeys: SIGNING_KEYS })).token;
    },
    async runProofScans() {
      for (const job of proofQueue.jobs.splice(0)) await jobs.scanProof(job);
    },
    runDeleteFiles: () => jobs.deleteFiles(),
    proofQueue: proofQueue.jobs,
    async stop() {
      await h.stop();
    },
  };
}
